// Wrangler bundles Markdown as text through the Text module rule.
declare module '*.md' {
  const text: string;
  export default text;
}
