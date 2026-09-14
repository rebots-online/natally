//! Mount as the `lore` plugin entrypoint (or re-export `init` from it).
//! I2 owns src/plugins/lore.rs, permissions, capabilities, and Cargo dependencies.
//! Dependencies: rusqlite (bundled), serde (derive), tauri 2.
//! DDL is supplied by common.ts from T0.9; no second application schema lives here.

use rusqlite::{
    params_from_iter, types::Value, Connection, OptionalExtension, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Mutex, time::Duration};
use tauri::Manager;

#[derive(Default)]
pub struct LoreState(Mutex<Connections>);

#[derive(Default)]
struct Connections {
    next_id: u32,
    handles: BTreeMap<u32, Connection>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Migration {
    id: u32,
    sql: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationOptions {
    vec: bool,
    extensions: bool,
    vec_dimensions: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    connection_id: u32,
    capabilities: Capabilities,
}

#[derive(Serialize)]
pub struct Capabilities {
    storage: &'static str,
    vec: VecCapability,
}

#[derive(Serialize)]
pub struct VecCapability {
    enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    dimensions: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub enum WireValue {
    Null,
    Number(f64),
    Text(String),
    Blob { blob: Vec<u8> },
}

impl WireValue {
    fn to_sql(&self) -> Result<Value, String> {
        Ok(match self {
            Self::Null => Value::Null,
            Self::Number(n)
                if n.is_finite() && n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0 =>
            {
                Value::Integer(*n as i64)
            }
            Self::Number(n) if n.is_finite() => Value::Real(*n),
            Self::Number(_) => return Err("SQL numbers must be finite".into()),
            Self::Text(s) => Value::Text(s.clone()),
            Self::Blob { blob } => Value::Blob(blob.clone()),
        })
    }

    fn from_sql(value: Value) -> Result<Self, String> {
        Ok(match value {
            Value::Null => Self::Null,
            Value::Integer(n) if n.unsigned_abs() <= 9_007_199_254_740_991 => {
                Self::Number(n as f64)
            }
            Value::Integer(_) => return Err("SQLite integer exceeds JavaScript precision".into()),
            Value::Real(n) if n.is_finite() => Self::Number(n),
            Value::Real(_) => return Err("SQLite returned a non-finite number".into()),
            Value::Text(s) => Self::Text(s),
            Value::Blob(blob) => Self::Blob { blob },
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Statement {
    sql: String,
    parameters: Vec<WireValue>,
}

type Row = BTreeMap<String, WireValue>;

fn migrate_connection(
    connection: &mut Connection,
    migrations: &[Migration],
    vector: Option<&Migration>,
    options: &MigrationOptions,
) -> Result<VecCapability, String> {
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    transaction
        .execute_batch("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)")
        .map_err(|e| e.to_string())?;
    for migration in migrations {
        apply_migration(&transaction, migration)?;
    }
    // The parent may statically register sqlite-vec before any connections open.
    // No extension path, network download, or claimed-success stub crosses IPC.
    let loaded: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_module_list WHERE name = 'vec0')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let schema: Option<String> = transaction
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name = 'vec_nodes'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if schema.is_some() && (!loaded || !options.vec || !options.extensions) {
        return Err("vec_nodes exists: reopen with sqlite-vec enabled before writing lore".into());
    }
    let enabled = options.vec && options.extensions && loaded;
    let dimensions = if enabled {
        let dimensions = options
            .vec_dimensions
            .filter(|n| *n > 0)
            .ok_or("vecDimensions is required with sqlite-vec")?;
        let vector = vector.ok_or("Missing canonical vector migration")?;
        if let Some(schema) = schema {
            let compact: String = schema.chars().filter(|c| !c.is_whitespace()).collect();
            if !compact
                .to_lowercase()
                .contains(&format!("float[{dimensions}]"))
            {
                return Err("vecDimensions does not match the persisted vec_nodes schema".into());
            }
        }
        apply_migration(&transaction, vector)?;
        Some(dimensions)
    } else {
        None
    };
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(VecCapability {
        enabled,
        dimensions,
        reason: if enabled {
            None
        } else if !options.vec || !options.extensions {
            Some("disabled")
        } else {
            Some("extension-unavailable")
        },
    })
}

fn apply_migration(connection: &Connection, migration: &Migration) -> Result<(), String> {
    let applied: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM _migrations WHERE id = ?)",
            [migration.id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !applied {
        connection
            .execute_batch(&migration.sql)
            .map_err(|e| e.to_string())?;
        connection
            .execute("INSERT INTO _migrations (id) VALUES (?)", [migration.id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn lore_open<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, LoreState>,
    migrations: Vec<Migration>,
    vector: Option<Migration>,
    options: MigrationOptions,
) -> Result<OpenResult, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let mut connection =
        Connection::open(directory.join("natally.sqlite3")).map_err(|e| e.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let vec = migrate_connection(&mut connection, &migrations, vector.as_ref(), &options)?;
    let mut state = state.0.lock().map_err(|e| e.to_string())?;
    let id = state
        .next_id
        .checked_add(1)
        .ok_or("Lore connection IDs exhausted")?;
    state.next_id = id;
    state.handles.insert(id, connection);
    Ok(OpenResult {
        connection_id: id,
        capabilities: Capabilities {
            storage: "native",
            vec,
        },
    })
}

fn execute_batch(
    connection: &mut Connection,
    statements: Vec<Statement>,
) -> Result<Vec<Vec<Row>>, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(statements.len());
    for statement in statements {
        let parameters: Vec<Value> = statement
            .parameters
            .iter()
            .map(WireValue::to_sql)
            .collect::<Result<_, _>>()?;
        let mut prepared = transaction
            .prepare(&statement.sql)
            .map_err(|e| e.to_string())?;
        let names: Vec<String> = prepared
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut result = Vec::new();
        if names.is_empty() {
            prepared
                .execute(params_from_iter(parameters))
                .map_err(|e| e.to_string())?;
        } else {
            let mut rows = prepared
                .query(params_from_iter(parameters))
                .map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let mut record = BTreeMap::new();
                for (index, name) in names.iter().enumerate() {
                    record.insert(
                        name.clone(),
                        WireValue::from_sql(row.get(index).map_err(|e| e.to_string())?)?,
                    );
                }
                result.push(record);
            }
        }
        results.push(result);
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(results)
}

#[tauri::command]
pub fn lore_batch(
    state: tauri::State<'_, LoreState>,
    connection_id: u32,
    statements: Vec<Statement>,
) -> Result<Vec<Vec<Row>>, String> {
    let mut state = state.0.lock().map_err(|e| e.to_string())?;
    let connection = state
        .handles
        .get_mut(&connection_id)
        .ok_or("Unknown Lore connection")?;
    execute_batch(connection, statements)
}

#[tauri::command]
pub fn lore_close(state: tauri::State<'_, LoreState>, connection_id: u32) -> Result<(), String> {
    let mut state = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(connection) = state.handles.remove(&connection_id) {
        if let Err((connection, error)) = connection.close() {
            state.handles.insert(connection_id, connection);
            return Err(error.to_string());
        }
    }
    Ok(())
}

crate::natally_plugin!(
    "lore",
    [lore_open, lore_batch, lore_close],
    setup = |app, _| {
        app.manage(LoreState::default());
        Ok(())
    }
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_roundtrips_blobs_and_rolls_back_constraint_failure() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE sample(id TEXT PRIMARY KEY, value BLOB NOT NULL)")
            .unwrap();
        let insert = || Statement {
            sql: "INSERT INTO sample VALUES (?, ?)".into(),
            parameters: vec![
                WireValue::Text("one".into()),
                WireValue::Blob {
                    blob: vec![0, 128, 255],
                },
            ],
        };
        execute_batch(&mut db, vec![insert()]).unwrap();
        let result = execute_batch(
            &mut db,
            vec![Statement {
                sql: "SELECT value FROM sample".into(),
                parameters: vec![],
            }],
        )
        .unwrap();
        assert!(
            matches!(&result[0][0]["value"], WireValue::Blob { blob } if blob == &[0, 128, 255])
        );
        let failure = execute_batch(
            &mut db,
            vec![
                Statement {
                    sql: "UPDATE sample SET value = ?".into(),
                    parameters: vec![WireValue::Blob { blob: vec![1] }],
                },
                insert(),
            ],
        );
        assert!(failure.is_err());
        let value: Vec<u8> = db
            .query_row("SELECT value FROM sample", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, vec![0, 128, 255]);
    }
}
