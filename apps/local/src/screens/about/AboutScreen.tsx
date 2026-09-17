import {
  GLOSSARY_ENTRIES,
  GlossaryCallout,
  glossaryProvenance,
} from "../../ui/glossary-callout.js";
import { VersionStamp } from "../../ui/version.js";
import "./about.css";

/**
 * U.7 — the About screen (`/about`). §6 AGPL posture, §5 provenance legend
 * (rendered as a labelled authored section), §11.1(a) legal links to the single
 * source legal documents, and a demonstrative consumption of the shared
 * GlossaryCallout. All content on this screen is authored-static education or
 * system facts; nothing here is a computed chart fact or a generated transcript.
 */

export function AboutScreen() {
  return (
    <section className="about" aria-label="About">
      <header className="about__header">
        <h1>About</h1>
        <VersionStamp />
      </header>

      <section className="about__section" data-provenance="authored-static" aria-label="License">
        <h2 className="about__label">{glossaryProvenance.label}</h2>
        <p>
          natally is licensed <strong>AGPL-3.0-or-later</strong>. Its source is available on written
          request.
        </p>
      </section>

      <section
        className="about__section"
        data-provenance="authored-static"
        aria-label="Provenance legend"
      >
        <h2 className="about__label">{glossaryProvenance.label}</h2>
        <h3>How natally labels what you read</h3>
        <ul className="about__legend">
          <li>
            <span className="about__data" data-provenance="computed">
              Computed facts
            </span>{" "}
            — engine results, rendered in Plex Mono.
          </li>
          <li>
            <span className="about__voice" data-provenance="generated">
              Generated text
            </span>{" "}
            — natally's own words, set in Fraunces in the margin.
          </li>
          <li>
            <span data-provenance="authored-static">Authored education</span> — static explanations,
            always shown inside a labelled section like this one.
          </li>
          <li>
            <span className="about__absence" data-provenance="absence">
              Absence
            </span>{" "}
            — when something is genuinely unknown, natally says so and never estimates.
          </li>
        </ul>
      </section>

      <section className="about__section" data-provenance="system" aria-label="Legal">
        <h2>Legal</h2>
        <p>
          Read our <a href="/legal/privacy.html">privacy policy</a> and{" "}
          <a href="/legal/terms.html">terms of use</a>.
        </p>
      </section>

      <section className="about__section" data-provenance="authored-static" aria-label="Glossary">
        <h2 className="about__label">{glossaryProvenance.label}</h2>
        <h3>Glossary</h3>
        <p>Hover or focus a term to read what it is.</p>
        <ul className="about__glossary">
          {GLOSSARY_ENTRIES.map((entryItem) => (
            <li key={entryItem.term}>
              <GlossaryCallout entry={entryItem} />
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

export default AboutScreen;
