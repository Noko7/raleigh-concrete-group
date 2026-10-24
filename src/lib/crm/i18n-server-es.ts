// Spanish for the messages server actions send back (errors, confirmations), read by tr() in ./i18n.
// Keys are the English text exactly as the action returns it; {name}-style placeholders match any text,
// and what they matched is itself translated when it's a known message. A key missing here, or English
// that has drifted from its key, shows in English: i18n-server-es.test.ts checks every key still exists.
// Staff-facing only. Customer pages and texts stay English.
export const SERVER_ES: Record<string, string> = {
  // Session and access
  "Your session expired. Please sign in again.": "Tu sesión expiró. Vuelve a iniciar sesión.",
  "Session expired. Please sign in again.": "Tu sesión expiró. Vuelve a iniciar sesión.",
  "Missing job id.": "Falta el trabajo.",
  "Missing quote id.": "Falta la cotización.",
  "You don't have access to this job.": "No tienes acceso a este trabajo.",
  "You don't have access to this quote.": "No tienes acceso a esta cotización.",
  "You can't change this job. It may have been reassigned to someone else.":
    "No puedes cambiar este trabajo. Puede que se lo hayan asignado a otra persona.",
  "This job changed while you were saving - the customer may have just answered, or it was reassigned. Reload it and try again.":
    "Este trabajo cambió mientras guardabas - puede que el cliente acabe de contestar, o que lo hayan reasignado. Recarga la página e inténtalo de nuevo.",
  "Quote not found.": "No se encontró la cotización.",
  "Job not found.": "No se encontró el trabajo.",
  "Could not load your job.": "No se pudo cargar tu trabajo.",

  // Writing and sending a quote
  "Could not read the line items. Please try again.": "No se pudieron leer las partidas. Inténtalo de nuevo.",
  "Could not read the options. Please try again.": "No se pudieron leer las opciones. Inténtalo de nuevo.",
  "Enter a valid quote amount.": "Escribe un monto válido para la cotización.",
  "Enter the customer's name.": "Escribe el nombre del cliente.",
  "Put a price on at least one line item before sending.": "Ponle precio al menos a una partida antes de enviar.",
  "This quote has one option on it, which is not a choice. Add a second option, or remove the one you have and it goes out as a single price.":
    "Esta cotización tiene una sola opción, y eso no es elegir. Agrega una segunda opción, o quita la que tienes y se envía con un solo precio.",
  "Put a price on every option before sending.": "Ponle precio a cada opción antes de enviar.",
  "Set a quote amount before sending.": "Pon el monto de la cotización antes de enviar.",
  'Fill in every section before sending. Still blank: {names}. Put "Not applicable" if a section doesn\'t apply to this job.':
    'Llena cada sección antes de enviar. Faltan: {names}. Usa "No aplica" si una sección no corresponde a este trabajo.',
  "{name} was already texted this quote and hasn't replied yet, so it won't send twice. If the quote itself was wrong, change the price or the wording and it goes out as a correction. If they say it never arrived, the owner can send it again.":
    "A {name} ya se le mandó esta cotización y todavía no contesta, así que no se envía dos veces. Si la cotización estaba mal, cambia el precio o el texto y se envía como corrección. Si dice que nunca le llegó, el dueño puede volver a mandarla.",
  "Could not save the line items.": "No se pudieron guardar las partidas.",
  "Could not save the options.": "No se pudieron guardar las opciones.",
  "Could not save. Check your access and try again.": "No se pudo guardar. Revisa tu acceso e inténtalo de nuevo.",
  "Something went wrong saving this quote. Please try again.": "Algo salió mal al guardar esta cotización. Inténtalo de nuevo.",
  'Enter a valid price for "{title}".': 'Escribe un precio válido para "{title}".',
  'Enter a price for "{title}".': 'Escribe un precio para "{title}".',
  "Could not save (error {code}). Please try again or call the office.":
    "No se pudo guardar (error {code}). Inténtalo de nuevo o llama a la oficina.",

  // A second option on a sent quote
  "This quote hasn't gone out yet. Write both options into the quote itself and send it once.":
    "Esta cotización todavía no se ha enviado. Escribe las dos opciones en la cotización y envíala una sola vez.",
  "They've already approved this quote. Adding an option now would change a job they've agreed to, so this needs a fresh quote.":
    "Ya aprobó esta cotización. Agregar una opción ahora cambiaría un trabajo que ya aceptó, así que hace falta una cotización nueva.",
  "This quote is marked declined. Ask the office to reopen it before sending another option.":
    "Esta cotización está marcada como rechazada. Pide a la oficina que la reabra antes de enviar otra opción.",
  "This job is already closed out.": "Este trabajo ya está cerrado.",
  "Give the quote they already have a name, so they can tell the two apart.":
    "Ponle nombre a la cotización que ya tiene, para que pueda distinguir las dos.",
  "Check the price on the option they already have.": "Revisa el precio de la opción que ya tiene.",
  'Give the new option a name, e.g. "Asphalt driveway".': 'Ponle nombre a la nueva opción, ej. "Asphalt driveway".',
  "Put a price on the new option.": "Ponle precio a la nueva opción.",
  "A quote can offer {n} options at most. Remove one in the quote editor first.":
    "Una cotización puede tener {n} opciones como máximo. Quita una en el editor primero.",
  "Could not save the new option.": "No se pudo guardar la nueva opción.",
  "The option was saved, but the quote could not be re-sent. Open the quote editor and send it.":
    "La opción se guardó, pero la cotización no se pudo volver a enviar. Abre el editor y envíala.",

  // Scheduling, visits and the calendar
  "Could not save that date.": "No se pudo guardar esa fecha.",
  "Could not save that date. Please try again.": "No se pudo guardar esa fecha. Inténtalo de nuevo.",
  "That date and time were already set.": "Esa fecha y hora ya estaban puestas.",
  "Date confirmed and customer texted.": "Fecha confirmada y se le avisó al cliente por mensaje.",
  "Date changed and everyone notified.": "Fecha cambiada y se les avisó a todos.",
  "Date changed. The crew was told; the customer was not texted.":
    "Fecha cambiada. Se le avisó al equipo; al cliente no se le mandó mensaje.",
  "Pick a valid date.": "Elige una fecha válida.",
  "Pick a start time.": "Elige una hora de inicio.",
  "Pick a valid time.": "Elige una hora válida.",
  "Pick the start time you agreed on.": "Elige la hora de inicio que acordaron.",
  "That day has already passed. Pick today or later.": "Ese día ya pasó. Elige hoy o una fecha posterior.",
  "Another job is already booked that day.": "Ya hay otro trabajo agendado ese día.",
  "Another job is already booked on that day.": "Ya hay otro trabajo agendado ese día.",
  "Another job is already booked that day. Record the approval without a date, or agree another day.":
    "Ya hay otro trabajo agendado ese día. Registra la aprobación sin fecha, o acuerden otro día.",
  "That crew is already booked on {name}'s job that day{when}. Pick another day, or assign this to someone else first.":
    "Ese equipo ya tiene el trabajo de {name} ese día{when}. Elige otro día, o asígnaselo a otra persona primero.",
  "That crew has a quote visit with {who}, and visits need an hour between them. Pick another time, or assign this to someone else first.":
    "Ese equipo tiene una visita para cotizar con {who}, y las visitas necesitan una hora entre una y otra. Elige otra hora, o asígnaselo a otra persona primero.",
  "Could not read the line item answers. Reload the page and try again.":
    "No se pudieron leer las respuestas de las partidas. Recarga la página e inténtalo de nuevo.",
  "Could not record that approval.": "No se pudo registrar esa aprobación.",
  "Approval recorded and the day is booked.": "Aprobación registrada y el día quedó agendado.",
  "Approval recorded and the job is ready to schedule.": "Aprobación registrada y el trabajo está listo para agendar.",
  "Approval recorded and the day is booked. The customer has been texted.":
    "Aprobación registrada y el día quedó agendado. Se le avisó al cliente por mensaje.",
  "Approval recorded and the job is ready to schedule. The customer has been texted.":
    "Aprobación registrada y el trabajo está listo para agendar. Se le avisó al cliente por mensaje.",
  "Approval recorded, but the day was NOT booked: {error} Set it on the schedule card below.":
    "Aprobación registrada, pero el día NO quedó agendado: {error} Ponlo en la tarjeta de agenda de abajo.",
  "Pick a date for the visit.": "Elige una fecha para la visita.",
  "Pick a time for the visit.": "Elige una hora para la visita.",
  "That was already the visit day and time. Nobody was texted.": "Ese ya era el día y la hora de la visita. No se le mandó mensaje a nadie.",
  "That was already the visit time.": "Esa ya era la hora de la visita.",
  "Could not confirm that visit.": "No se pudo confirmar esa visita.",
  "Visit moved. The customer has been texted the new day, and so has the crew.":
    "Visita cambiada. Se le mandó el nuevo día al cliente y al equipo.",
  "Visit moved. The crew was told; the customer was not texted.":
    "Visita cambiada. Se le avisó al equipo; al cliente no se le mandó mensaje.",
  "Visit moved. The customer and the crew were texted.": "Visita cambiada. Se le mandó mensaje al cliente y al equipo.",
  "Visit confirmed for the new day. The customer and the crew have been texted.":
    "Visita confirmada para el nuevo día. Se le mandó mensaje al cliente y al equipo.",
  "Visit confirmed. The customer and the crew have been texted.": "Visita confirmada. Se le mandó mensaje al cliente y al equipo.",
  "Could not move that visit.": "No se pudo cambiar esa visita.",
  "Missing appointment.": "Falta la cita.",
  "That appointment was already cancelled. Nobody was texted.": "Esa cita ya estaba cancelada. No se le mandó mensaje a nadie.",
  "Could not cancel that appointment.": "No se pudo cancelar esa cita.",
  "Could not remove that appointment.": "No se pudo quitar esa cita.",
  "Date released. {name} is back in Needs scheduling{texted}": "Fecha liberada. {name} vuelve a Falta agendar{texted}",
  "Visit cancelled{texted}": "Visita cancelada{texted}",
  "Job moved.": "Trabajo cambiado.",

  // Held texts
  "Missing message.": "Falta el mensaje.",
  "That text is no longer in the queue.": "Ese mensaje ya no está en la cola.",
  "That text was cancelled, so there is nothing to send.": "Ese mensaje se canceló, así que no hay nada que enviar.",
  "That text has already gone out.": "Ese mensaje ya se envió.",
  "Sent. It has gone out now rather than waiting.": "Enviado. Salió ahora en vez de esperar.",
  "That text has been stopped. It will not send.": "Ese mensaje se detuvo. No se va a enviar.",
  "Only the owner can cancel a quote. Ask them to retract it, or send a corrected quote instead.":
    "Solo el dueño puede cancelar una cotización. Pídele que la retire, o envía una cotización corregida.",
  "This job has a booked work day. Release the date first.": "Este trabajo tiene un día agendado. Libera la fecha primero.",
  "Too late: that text has already gone out or is being sent right now.":
    "Muy tarde: ese mensaje ya salió o se está enviando en este momento.",

  // Change orders
  "Enter the new total for the job.": "Escribe el nuevo total del trabajo.",
  "Open the review step and confirm the recorded payments before sending this.":
    "Abre la revisión y confirma los pagos registrados antes de enviar esto.",
  "The price on this job changed while you were writing. Close this and start the change again.":
    "El precio de este trabajo cambió mientras escribías. Cierra esto y empieza el cambio de nuevo.",
  "Could not read the price breakdown. Please try again.": "No se pudo leer el desglose del precio. Inténtalo de nuevo.",
  "Pick how they paid for the change.": "Elige cómo pagó el cambio.",
  "Enter how much they paid for the change.": "Escribe cuánto pagó por el cambio.",
  "Could not send that change.": "No se pudo enviar ese cambio.",
  "That's more than the {amount} they'll owe after this change. Enter the amount actually taken.":
    "Eso es más de los {amount} que va a deber después de este cambio. Escribe la cantidad que realmente recibiste.",
  "The change was saved but the price didn't update. Withdraw it and try again.":
    "El cambio se guardó pero el precio no se actualizó. Retíralo e inténtalo de nuevo.",
  "Change sent to {name} to approve. Nothing moves until they do.":
    "Cambio enviado a {name} para que lo apruebe. Nada cambia hasta que lo apruebe.",
  "Could not withdraw that change.": "No se pudo retirar ese cambio.",
  "Change withdrawn. The price is unchanged.": "Cambio retirado. El precio sigue igual.",
  "Change withdrawn. The price is unchanged. The text to {name} was stopped before it went out.":
    "Cambio retirado. El precio sigue igual. El mensaje a {name} se detuvo antes de salir.",
  "Change withdrawn. The price is unchanged. {name} was texted that it's withdrawn.":
    "Cambio retirado. El precio sigue igual. Se le avisó a {name} por mensaje que se retiró.",
  "Change withdrawn. The price is unchanged. {name} will be texted that it's withdrawn {when}.":
    "Cambio retirado. El precio sigue igual. A {name} se le avisa por mensaje que se retiró {when}.",
  '{name} already had the change text, and the "it\'s withdrawn" text didn\'t send{detail}. Give them a call so they don\'t look for it.':
    '{name} ya tenía el mensaje del cambio, y el mensaje de "se retiró" no se envió{detail}. Llámale para que no lo ande buscando.',
  "This job isn't approved yet. Change the quote itself instead.": "Este trabajo todavía no está aprobado. Cambia la cotización directamente.",
  "This job is already closed out. Give the office a call to sort out the price.":
    "Este trabajo ya está cerrado. Llama a la oficina para arreglar el precio.",
  "There's already a change waiting on the customer. Withdraw it first.": "Ya hay un cambio esperando al cliente. Retíralo primero.",
  "Say what's changing, so the customer knows what they're approving.": "Di qué cambia, para que el cliente sepa qué está aprobando.",
  "This job was priced as a choice of options, so change the total as one figure.":
    "Este trabajo se cotizó con opciones a elegir, así que cambia el total como una sola cifra.",
  "Enter a valid new total for the job.": "Escribe un nuevo total válido para el trabajo.",
  "That's the same total they already agreed to. Change the figure, or just call them.":
    "Ese es el mismo total que ya aceptó. Cambia la cifra, o mejor llámale.",
  "Enter how much they need to send up front, or untick the deposit.":
    "Escribe cuánto tiene que mandar por adelantado, o quita el depósito.",
  "The deposit can't be more than what they'll owe after this change.":
    "El depósito no puede ser más de lo que va a deber después de este cambio.",
  "Could not send that change. Please try again or call the office.": "No se pudo enviar ese cambio. Inténtalo de nuevo o llama a la oficina.",
  "There's no change waiting on this job.": "No hay ningún cambio esperando en este trabajo.",
  "This change was updated, please reload the page.": "Este cambio se actualizó, recarga la página.",
  "Lowering an approved price is done by the office.": "Bajar un precio ya aprobado lo hace la oficina.",
  "A change order can only be sent in your own name.": "Un cambio solo se puede enviar a tu nombre.",
  "Only the owner can apply a change without texting the customer. Send it to {name} to approve instead - nothing moves until they do.":
    "Solo el dueño puede aplicar un cambio sin mandarle mensaje al cliente. Envíaselo a {name} para que lo apruebe - nada cambia hasta que lo apruebe.",
  "The deposit on a change is set when the customer approves that change. Send them a change order to ask for one.":
    "El depósito de un cambio se fija cuando el cliente aprueba ese cambio. Mándale un cambio para pedirlo.",

  // Office-only rules a contractor can bump into
  "Only the office can mark a job paid. It moves to Paid by itself once the payments recorded on it add up to the total.":
    "Solo la oficina puede marcar un trabajo como pagado. Pasa a Pagado solo cuando los pagos registrados suman el total.",
  "This job is marked paid, so only the office can move it. Give them a call if it needs changing.":
    "Este trabajo está marcado como pagado, así que solo la oficina lo puede mover. Llámales si hay que cambiarlo.",
  "Only the office can change that on a job.": "Solo la oficina puede cambiar eso en un trabajo.",
  "Only the office can change the customer's phone or email.": "Solo la oficina puede cambiar el teléfono o el correo del cliente.",
  "Owners only.": "Solo para dueños.",

  // Payments
  "Nothing to collect - this job is paid in full.": "No hay nada que cobrar - este trabajo está pagado completo.",
  "Saved. The text goes out {when}.": "Guardado. El mensaje sale {when}.",
  "The text didn't send. Call the office.": "El mensaje no se envió. Llama a la oficina.",
  "Payment link texted to {name}.": "Enlace de pago enviado a {name} por mensaje.",
  "Pick how the customer paid.": "Elige cómo pagó el cliente.",
  "Enter how much they paid.": "Escribe cuánto pagó.",
  "Could not save that payment.": "No se pudo guardar ese pago.",
  "Could not save that payment. Please try again.": "No se pudo guardar ese pago. Inténtalo de nuevo.",
  "This job has no price on it yet, so there's nothing to pay against.":
    "Este trabajo todavía no tiene precio, así que no hay contra qué pagar.",
  "That's more than the {amount} still owed. Enter the amount actually taken.":
    "Eso es más de los {amount} que todavía se deben. Escribe la cantidad que realmente recibiste.",
  "Missing payment.": "Falta el pago.",
  "That payment isn't on this job.": "Ese pago no es de este trabajo.",
  "Enter what they actually paid.": "Escribe lo que realmente pagó.",
  "That would collect more than the job is worth. The most this payment can be is {amount}.":
    "Eso cobraría más de lo que vale el trabajo. Este pago puede ser de {amount} como máximo.",
  "Nothing changed on that payment.": "No cambió nada en ese pago.",
  "Could not save that correction.": "No se pudo guardar esa corrección.",
  "Could not save that correction. Please try again.": "No se pudo guardar esa corrección. Inténtalo de nuevo.",
  "Corrected to {amount}. {due} still to collect.": "Corregido a {amount}. Faltan {due} por cobrar.",
  "Corrected to {amount}. This job is paid in full.": "Corregido a {amount}. Este trabajo está pagado completo.",
  "Say why it's being voided - it goes on the record.": "Di por qué se anula - queda en el registro.",
  "Could not void that payment.": "No se pudo anular ese pago.",
  "Could not void that payment. Please try again.": "No se pudo anular ese pago. Inténtalo de nuevo.",
  "{amount} taken off the books. {due} still to collect.": "{amount} quitados de las cuentas. Faltan {due} por cobrar.",
  "Enter the amount to waive, or 0 to clear it.": "Escribe la cantidad a perdonar, o 0 para quitarla.",
  "That's more than the whole {amount} fee on this job.": "Eso es más que toda la comisión de {amount} de este trabajo.",
  "Could not save that. Please try again.": "No se pudo guardar. Inténtalo de nuevo.",
  "{amount} of your fee waived on this job.": "Se perdonaron {amount} de tu comisión en este trabajo.",
  "Card payments come from Stripe and can't be edited here. Refund it instead if the money needs to go back.":
    "Los pagos con tarjeta vienen de Stripe y no se pueden editar aquí. Si hay que devolver el dinero, haz un reembolso.",
  "That payment is already voided.": "Ese pago ya está anulado.",
  "Only a recorded payment can be corrected. This one never completed.": "Solo se puede corregir un pago registrado. Este nunca se completó.",
  "Part of this payment has already been refunded, so the record has to stand. Call the office.":
    "Parte de este pago ya se reembolsó, así que el registro se queda como está. Llama a la oficina.",
  "That's less than the office's cut already taken out of this payment.":
    "Eso es menos de la comisión de la oficina que ya se descontó de este pago.",
  "Enter an amount of at least $1.": "Escribe una cantidad de al menos $1.",
  "This job is already paid in full.": "Este trabajo ya está pagado completo.",
  "That's more than the balance left on this job.": "Eso es más del saldo que queda en este trabajo.",

  // Closing out a job
  "Upload before and after photos before closing this job out.": "Sube fotos de antes y después antes de cerrar este trabajo.",
  "Upload {kind} photos before closing this job out.": "Sube las fotos de {kind} antes de cerrar este trabajo.",
  "Could not close this job out. Please try again.": "No se pudo cerrar este trabajo. Inténtalo de nuevo.",
  "Job closed out and the customer has been thanked.": "Trabajo cerrado y se le dio las gracias al cliente.",

  // The board and settings
  "Unknown status.": "Estado desconocido.",
  "Could not move this quote.": "No se pudo mover esta cotización.",
  "Enter a valid US phone number, e.g. (919) 555-1234.": "Escribe un número de teléfono válido de EE. UU., por ejemplo (919) 555-1234.",
  "Could not save your settings. Please try again.": "No se pudieron guardar tus ajustes. Inténtalo de nuevo.",
  "Pick a first and last visit time.": "Elige la hora de la primera y la última visita.",
  "The last visit can't be earlier than the first.": "La última visita no puede ser antes que la primera.",
  "Pick at least one day, otherwise nobody can book you.": "Elige al menos un día; si no, nadie te puede reservar.",
  "Could not save your hours. Please try again.": "No se pudo guardar tu horario. Inténtalo de nuevo.",

  // Translating a Spanish-mode writer's quote
  "Translation isn't available right now. Write it in English, or try again in a few minutes.":
    "La traducción no está disponible ahora. Escríbelo en inglés, o inténtalo de nuevo en unos minutos.",
  "Translation isn't set up yet. Ask the office, or write it in English for now.":
    "La traducción todavía no está configurada. Pregúntale a la oficina, o escríbelo en inglés por ahora.",
  "That's too much text to translate at once. Shorten it, or split it up.":
    "Es demasiado texto para traducir de una vez. Acórtalo o divídelo.",

  // Generic
  "Something went wrong. Please try again.": "Algo salió mal. Inténtalo de nuevo.",
  "Send failed": "No se pudo enviar",
};

// Fragments the actions splice into a message, translated only where a placeholder above captured them, so
// a short pattern like " at {time}" can't rewrite a whole message it happens to fit.
export const SERVER_ES_PARTS: Record<string, string> = {
  " at {time}": " a las {time}",
  "{name} at {time}": "{name} a las {time}",
  before: "antes",
  after: "después",
  " and was texted.": " y se le avisó por mensaje.",
  " and the customer was texted.": " y se le avisó al cliente por mensaje.",
};
