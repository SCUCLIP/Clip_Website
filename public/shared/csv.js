/* A sign-up list as CSV, for the editor's download (the Worker and the demo both use this).
   A cell a spreadsheet would read as a formula (=, +, -, @) gets a leading quote, so it stays text. */

const cell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** @param {{ email: string, createdAt: string }[]} rows */
export const signupsCsv = (rows) => "email,signed_up\r\n" + rows.map((r) => cell(r.email) + "," + cell(r.createdAt)).join("\r\n") + "\r\n";
