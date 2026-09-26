# Law Enforcement and Government Data Requests

The short version: **verify, minimize, log, notify unless legally barred.** Never hand over customer data
because an email asked for it.

## 1. Intake

Requests can arrive at the support/privacy contact or by post. Anyone receiving one must forward it to the
maintainer acting as the legal contact **within one business day** and reply to the requester with no
substantive information beyond acknowledgement.

Accept and process:

- Valid court orders, subpoenas, search warrants, and equivalent legal process in the jurisdiction that
  issued them.

Do not process:

- Informal requests from an officer, agency, or "investigator" that are not legal process.
- Requests from a private party (including a customer's litigation opponent) — those are civil discovery
  matters; the requesting party must obtain the data from the customer, not from us.
- Emergency "disclosure" demands without the required certifications.

## 2. Verification

Confirm before responding:

1. **Authenticity** — the document comes from a court or agency with jurisdiction; check contact details
   against the issuer's published information, not the ones in the request.
2. **Authority** — it compels *us* (the operator of this deployment) and covers the data requested.
3. **Scope** — the named tenants, time range, and data types. Reject or negotiate anything broader than the
   order permits; most orders do not authorize a full account dump.
4. **Preservation** — if the order or a valid preservation request requires it, snapshot the specific data
   now (before retention sweeps run) and record that you did.

## 3. Response rules

- Disclose the **minimum** necessary: specific fields, specific tenants, specific time window.
- Prefer aggregated or metadata-level data where it answers the request.
- Do not provide master keys, credential ciphertext, session tokens, or password hashes. We cannot decrypt a
  customer's integration credentials for a third party, and hashes are not useful data.
- Do not build new data or run new analysis to answer a request. Produce what exists.
- Do not give testimony or an affidavit beyond a factual certification of records, and do not characterize
  the data's meaning.

## 4. Notifying the customer

Tell the affected customer **before** producing the data, unless:

- a court order or statute bars notice;
- notice would create a risk of death or serious physical harm;
- the request is an emergency disclosure request where delay is itself harmful.

Where notice is barred, give it as soon as the bar lifts, and record why it was delayed. Government access
requests received by a subprocessor must be passed on to us by that vendor, and we pass them to the customer.

## 5. Logging

Every request, including ones we refuse, gets a `privacy_requests` row (`kind = "access"`, with the details
field describing the legal instrument and our response) plus an entry in the maintainer's private incident
log with: date received, issuer, scope, data produced, date produced, notice given or reason for delay, and
the person who approved the response. Keep the request document itself. Retain these records for the period
their jurisdiction requires, and never delete them to tidy up.

## 6. Transparency

Publish non-identifying aggregate counts (for example "0 government requests received this year") in the
repository so customers can see the pattern. Do not publish anything that would tip off a target of an
investigation or violate a gag order.

## 7. Emergencies

Life-threatening emergencies are handled promptly, not refused on procedure. The maintainer acting as legal
contact may authorize disclosure of the minimum data needed (typically account email, name, and last sign-in
time) when there is a credible emergency, and must document: who asked, what they asserted, what was
disclosed, and why it was an emergency. Follow up with the customer as soon as it is safe to do so.
