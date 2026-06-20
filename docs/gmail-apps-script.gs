/**
 * MzansiMoney - Gmail auto-import (Google Apps Script).
 *
 * Reads PDF attachments from emails under the "MzansiMoney" label and posts them to
 * MzansiMoney's secured intake endpoint, which classifies + dedupes them (invoices ->
 * bills automatically). Runs as YOU, on an hourly trigger - no OAuth app setup.
 *
 * SETUP
 *  0. (Recommended) Import `gmail-filters.xml` in Gmail so your billers get the
 *     "MzansiMoney" label automatically - then you never hand-label anything.
 *  1. Go to https://script.google.com -> New project. Paste this whole file.
 *  2. Put your real secret in SECRET below (MzansiMoney gave it to you separately).
 *  3. Save. Run `importStatements` once and click through the Google authorization
 *     prompt (it's your own account / your own script).
 *  4. Click the clock icon (Triggers) -> Add Trigger -> function: importStatements,
 *     event source: Time-driven, Hour timer, Every hour. Save.
 *
 * It only ever reads the "MzansiMoney" label. Already-processed messages are remembered
 * (script properties) so nothing is sent twice; the endpoint also dedupes.
 */
const ENDPOINT = 'https://africa-south1-your-project-id.cloudfunctions.net/ingest_email';
const SECRET = 'PASTE_YOUR_SECRET_HERE';
const LABEL = 'MzansiMoney';

function importStatements() {
  const label = GmailApp.getUserLabelByName(LABEL);
  if (!label) { Logger.log('No "' + LABEL + '" label found.'); return; }
  const props = PropertiesService.getUserProperties();

  const threads = label.getThreads(0, 100);
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const id = msg.getId();
      if (props.getProperty('done_' + id)) return; // already handled

      msg.getAttachments().forEach(function (att) {
        const name = att.getName() || '';
        const isPdf = att.getContentType() === 'application/pdf' || /\.pdf$/i.test(name);
        if (!isPdf) return;
        try {
          const b64 = Utilities.base64Encode(att.getBytes());
          // Per-ATTACHMENT key (message id + filename), not just the message id -
          // otherwise a single email with two PDFs would have its second
          // attachment dropped as a "duplicate" by the intake dedup.
          const gmailMessageId = id + ':' + name;
          // Authenticate with an HMAC over (timestamp . gmailMessageId . payload)
          // so the shared secret never travels on the wire, a captured request
          // can't be replayed once the timestamp goes stale (~5 min server skew),
          // and the dedup key can't be forged independently of the signature.
          const ts = Date.now();
          const sig = signHmacSha256(SECRET, ts + '.' + gmailMessageId + '.' + b64);
          const res = UrlFetchApp.fetch(ENDPOINT, {
            method: 'post',
            contentType: 'application/json',
            muteHttpExceptions: true,
            payload: JSON.stringify({
              ts: ts,
              sig: sig,
              filename: name,
              gmailMessageId: gmailMessageId,
              pdfBase64: b64
            })
          });
          Logger.log(name + ' -> ' + res.getResponseCode() + ' ' + res.getContentText());
        } catch (e) {
          Logger.log('error ' + name + ': ' + e);
        }
      });

      props.setProperty('done_' + id, '1'); // mark processed (even if no PDF)
    });
  });
}

// Lower-case hex HMAC-SHA256, matching Python's hmac.new(...).hexdigest() server side.
function signHmacSha256(key, value) {
  const raw = Utilities.computeHmacSha256Signature(value, key);
  return raw.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}
