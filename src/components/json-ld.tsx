// Renders one or more JSON-LD structured-data blocks. Server component.
// `<` is escaped to its unicode form so no value can ever close the surrounding
// <script> tag and break out into executable HTML (defense against XSS if any
// dynamic/user-derived value is ever fed into the schema).
function safeJson(block: object): string {
  return JSON.stringify(block).replace(/</g, "\\u003c");
}

export function JsonLd({ data }: { data: object | object[] }) {
  const blocks = Array.isArray(data) ? data : [data];
  return (
    <>
      {blocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJson(block) }}
        />
      ))}
    </>
  );
}
