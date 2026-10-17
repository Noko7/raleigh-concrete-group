// `<` is escaped so no value can close the <script> tag (XSS defence if a dynamic value ever gets in).
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
