import { ambitiousLint } from "@ambitious/lint";

export default ambitiousLint({ root: import.meta.dirname, ignores: [".work/**", "release/**", ".verify-evidence/**"] });
