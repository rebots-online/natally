import version from "../../../../version.json";
import "./primitives/primitives.css";

/** TOKENS.md data/micro (11/14): the sole exception to the 12px text floor. */
export function VersionStamp() {
  return (
    <span className="ui-version" role="note" aria-label={`Version ${version.version}`}>
      v{version.version}
    </span>
  );
}
