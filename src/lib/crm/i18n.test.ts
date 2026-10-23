// Spanish mode: the dictionary, and tr() for the messages server actions send back.
//
// The dictionary's completeness is the type checker's job (es is typed as the English Dict). What it can't
// see is the server catalog drifting: its keys are English text copied from the actions, so a reworded
// message would quietly fall back to English. The last test catches that.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { dict, intlLocale, tr } from "./i18n.ts";
import { SERVER_ES, SERVER_ES_PARTS } from "./i18n-server-es.ts";

test("dict: Spanish for es, English for anything else", () => {
  assert.equal(dict("es").nav.calendar, "Calendario");
  assert.equal(dict("en").nav.calendar, "Calendar");
  assert.equal(dict(null).nav.calendar, "Calendar");
  assert.equal(dict("fr").nav.calendar, "Calendar");
  assert.equal(intlLocale("es"), "es-US");
  assert.equal(intlLocale("en"), "en-US");
});

test("tr: English readers get the message untouched", () => {
  assert.equal(tr("en", "Could not send that change."), "Could not send that change.");
  assert.equal(tr("es", undefined), undefined);
  assert.equal(tr("es", ""), "");
});

test("tr: exact messages", () => {
  assert.equal(tr("es", "Could not send that change."), "No se pudo enviar ese cambio.");
});

test("tr: placeholders keep names and amounts", () => {
  assert.equal(
    tr("es", "Change sent to Chris to approve. Nothing moves until they do."),
    "Cambio enviado a Chris para que lo apruebe. Nada cambia hasta que lo apruebe.",
  );
  assert.equal(
    tr("es", "$125.00 taken off the books. $9,340.00 still to collect."),
    "$125.00 quitados de las cuentas. Faltan $9,340.00 por cobrar.",
  );
});

test("tr: a captured part that is itself a known message is translated too", () => {
  assert.equal(
    tr("es", "Approval recorded, but the day was NOT booked: Another job is already booked that day. Set it on the schedule card below."),
    "Aprobación registrada, pero el día NO quedó agendado: Ya hay otro trabajo agendado ese día. Ponlo en la tarjeta de agenda de abajo.",
  );
  assert.equal(
    tr("es", "That crew has a quote visit with Dana at 9:00 AM, and visits need an hour between them. Pick another time, or assign this to someone else first."),
    "Ese equipo tiene una visita para cotizar con Dana a las 9:00 AM, y las visitas necesitan una hora entre una y otra. Elige otra hora, o asígnaselo a otra persona primero.",
  );
  assert.equal(
    tr("es", "That crew has a quote visit with Dana, and visits need an hour between them. Pick another time, or assign this to someone else first."),
    "Ese equipo tiene una visita para cotizar con Dana, y las visitas necesitan una hora entre una y otra. Elige otra hora, o asígnaselo a otra persona primero.",
  );
  assert.equal(
    tr("es", "Upload after photos before closing this job out."),
    "Sube las fotos de después antes de cerrar este trabajo.",
  );
  assert.equal(tr("es", "Visit cancelled."), "Visita cancelada.");
  assert.equal(tr("es", "Visit cancelled and the customer was texted."), "Visita cancelada y se le avisó al cliente por mensaje.");
});

test("tr: fragments never rewrite a whole message", () => {
  assert.equal(tr("es", "Saved at 5:00 PM"), "Saved at 5:00 PM");
  assert.equal(tr("es", "before"), "before");
});

test("tr: an unknown message stays English rather than going blank", () => {
  assert.equal(tr("es", "A message nobody has translated."), "A message nobody has translated.");
});

// Every sentence of every key must still appear in the code, placeholders aside, or the key no longer
// matches anything the server sends.
function sourceText(dir: string): string {
  let out = "";
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out += sourceText(path);
    else if (/\.tsx?$/.test(name) && !/i18n-server-es\.ts$|\.test\.ts$/.test(name)) out += readFileSync(path, "utf8");
  }
  return out;
}

test("every server message key still exists in the code", () => {
  // Template literals and escaped quotes, read as the plain text they produce.
  const src = sourceText(join(import.meta.dirname, "..", "..")).replace(/\\"/g, '"');
  const stale = [...Object.keys(SERVER_ES), ...Object.keys(SERVER_ES_PARTS)].filter((key) =>
    key
      .split(/\{\w+\}/)
      .flatMap((piece) => piece.split(/(?<=\.) /))
      .map((piece) => piece.trim())
      .filter((piece) => piece.length >= 12)
      .some((piece) => !src.includes(piece)),
  );
  assert.deepEqual(stale, []);
});
