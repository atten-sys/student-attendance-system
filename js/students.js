
if (Auth.guard()) {
  let students = [];

  const dlg = document.getElementById("studentDialog");
  const form = document.getElementById("studentForm");

  // ---------- STUDENT LIST ----------
  async function load() {
    try {
      students = rows(await API.get("/api/users"));
      render();
    } catch (e) {
      document.getElementById("studentTable").textContent = e.message;
    }
  }

  function render() {
    const q = document.getElementById("studentSearch").value.toLowerCase();

    const a = students.filter(s =>
      JSON.stringify(s).toLowerCase().includes(q)
    );

    document.getElementById("studentTable").innerHTML = a.length
      ? '<table><thead><tr><th>Student no.</th><th>Name</th><th>Grade / section</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
        a.map(s => `
          <tr>
            <td>${esc(s.student_number || s.student_id || s.id)}</td>
            <td>${esc((s.first_name || s.name || "") + " " + (s.last_name || ""))}</td>
            <td>${esc(s.grade_section || s.grade || "—")}</td>
            <td><span class="pill ${s.status === "inactive" ? "inactive" : ""}">${esc(s.status || "active")}</span></td>
            <td>
              <button class="table-action" data-edit="${esc(s.id)}">Edit</button>
              <button class="table-action" data-delete="${esc(s.id)}">Delete</button>
            </td>
          </tr>
        `).join("") +
        "</tbody></table>"
      : '<p class="muted">No matching students.</p>';

    document.querySelectorAll("[data-edit]").forEach(b =>
      b.onclick = () => edit(b.dataset.edit)
    );

    document.querySelectorAll("[data-delete]").forEach(b =>
      b.onclick = () => remove(b.dataset.delete)
    );
  }

  function edit(id) {
    const s = students.find(x => String(x.id) === String(id));

    form.reset();

    for (const [k, v] of Object.entries(s || {})) {
      if (form.elements[k]) form.elements[k].value = v ?? "";
    }

    form.elements.id.value = id;
    document.getElementById("studentDialogTitle").textContent = "Edit student";
    dlg.showModal();
  }

  async function remove(id) {
    if (!confirm("Delete this student record?")) return;

    try {
      await API.delete("/api/users/" + encodeURIComponent(id));
      notify("Student deleted");
      load();
    } catch (e) {
      notify(e.message);
    }
  }

  document.getElementById("addStudentBtn").onclick = () => {
    form.reset();
    form.elements.id.value = "";
    document.getElementById("studentDialogTitle").textContent = "Add student";
    dlg.showModal();
  };

  ["closeStudent", "cancelStudent"].forEach(id => {
    document.getElementById(id).onclick = () => dlg.close();
  });

  form.onsubmit = async e => {
    e.preventDefault();

    const d = Object.fromEntries(new FormData(form));
    const id = d.id;
    delete d.id;

    try {
      if (id) {
        await API.put("/api/users/" + encodeURIComponent(id), d);
      } else {
        await API.post("/api/users", d);
      }

      dlg.close();
      notify("Student saved");
      load();
    } catch (x) {
      document.getElementById("studentError").textContent = x.message;
    }
  };

  document.getElementById("studentSearch").oninput = render;

  document.getElementById("exportStudents").onclick = () => {
    csvDownload("students.csv", students);
  };

  // ---------- CSV IMPORT UI ----------
  const importBtn = document.createElement("button");
  importBtn.className = "btn secondary";
  importBtn.textContent = "⬆ Import CSV";

  document.getElementById("exportStudents").after(importBtn);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".csv,text/csv";
  fileInput.hidden = true;
  document.body.appendChild(fileInput);

  const previewDialog = document.createElement("dialog");
  previewDialog.className = "dialog";
  previewDialog.style.maxWidth = "850px";
  previewDialog.style.width = "95%";

  previewDialog.innerHTML = `
    <div class="panel-head">
      <h2>Import students from CSV</h2>
      <button type="button" class="icon-btn" id="csvClose">✕</button>
    </div>

    <p class="muted" id="csvSummary"></p>

    <div class="table-wrap" style="max-height:400px;overflow:auto">
      <table>
        <thead>
          <tr>
            <th>Student number</th>
            <th>First name</th>
            <th>Last name</th>
            <th>Grade / section</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody id="csvPreviewRows"></tbody>
      </table>
    </div>

    <div class="dialog-actions">
      <button type="button" class="btn secondary" id="csvCancel">Cancel</button>
      <button type="button" class="btn primary" id="csvImport">Import students</button>
    </div>

    <p id="csvMessage" class="error"></p>
  `;

  document.body.appendChild(previewDialog);

  let csvRecords = [];

  function safe(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  importBtn.onclick = () => fileInput.click();

  document.getElementById("csvClose").onclick =
  document.getElementById("csvCancel").onclick = () => {
    previewDialog.close();
  };

  // ---------- CSV PARSER ----------
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");

    const lines = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (c === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;

        row.push(cell.trim());

        if (row.some(v => v !== "")) lines.push(row);

        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }

    row.push(cell.trim());
    if (row.some(v => v !== "")) lines.push(row);

    if (lines.length < 2) {
      throw new Error("The CSV file has no student records.");
    }

    const headers = lines[0].map(h =>
      h.toLowerCase().replace(/[^a-z0-9]/g, "")
    );

    return lines.slice(1).map(values => {
      const record = {};

      headers.forEach((header, i) => {
        record[header] = values[i] ?? "";
      });

      return record;
    });
  }

  function getValue(row, names) {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== "") {
        return row[name].trim();
      }
    }
    return "";
  }

  function normalizeRecord(row) {
    const studentNumber = getValue(row, [
      "studentnumber",
      "studentid",
      "studentno",
      "idnumber"
    ]);

    let firstName = getValue(row, [
      "firstname",
      "givenname"
    ]);

    let lastName = getValue(row, [
      "lastname",
      "surname",
      "familyname"
    ]);

    const fullName = getValue(row, [
      "fullname",
      "name"
    ]);

    if (!firstName && fullName) {
      const parts = fullName.split(/\s+/);
      firstName = parts.shift() || "";
      lastName = parts.join(" ");
    }

    return {
      student_number: studentNumber,
      first_name: firstName,
      last_name: lastName,
      grade_section: getValue(row, [
        "gradesection",
        "grade",
        "section"
      ]),
      email: getValue(row, ["email"]),
      status: (getValue(row, ["status"]) || "active").toLowerCase()
    };
  }

  // ---------- READ AND PREVIEW ----------
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseCSV(text);

      csvRecords = parsed.map((row, index) => ({
        line: index + 2,
        data: normalizeRecord(row),
        error: ""
      }));

      const existing = new Set(
        students.map(s =>
          String(s.student_number || s.student_id || "").trim().toLowerCase()
        ).filter(Boolean)
      );

      const seen = new Set();

      csvRecords.forEach(record => {
        const s = record.data;
        const number = s.student_number.toLowerCase();

        if (!s.student_number) {
          record.error = "Missing student number";
        } else if (!s.first_name || !s.last_name) {
          record.error = "Missing first or last name";
        } else if (existing.has(number)) {
          record.error = "Already exists";
        } else if (seen.has(number)) {
          record.error = "Duplicate in CSV";
        } else {
          seen.add(number);
        }
      });

      showCSVPreview();
      previewDialog.showModal();

    } catch (e) {
      notify(e.message || "Unable to read CSV file");
    }

    fileInput.value = "";
  };

  function showCSVPreview() {
    const valid = csvRecords.filter(r => !r.error).length;
    const invalid = csvRecords.length - valid;

    document.getElementById("csvSummary").textContent =
      `${csvRecords.length} records found · ${valid} ready to import · ${invalid} skipped`;

    document.getElementById("csvPreviewRows").innerHTML =
      csvRecords.map(r => {
        const s = r.data;

        return `
          <tr>
            <td>${safe(s.student_number)}</td>
            <td>${safe(s.first_name)}</td>
            <td>${safe(s.last_name)}</td>
            <td>${safe(s.grade_section || "—")}</td>
            <td>${r.error
              ? `<span class="pill inactive">${safe(r.error)}</span>`
              : '<span class="pill">Ready</span>'}
            </td>
          </tr>
        `;
      }).join("");

    document.getElementById("csvImport").disabled = valid === 0;
    document.getElementById("csvMessage").textContent = "";
  }

  // ---------- IMPORT RECORDS ----------
  document.getElementById("csvImport").onclick = async () => {
    const button = document.getElementById("csvImport");
    const message = document.getElementById("csvMessage");

    const validRecords = csvRecords.filter(r => !r.error);

    if (!validRecords.length) {
      message.textContent = "There are no valid records to import.";
      return;
    }

    if (!confirm(`Import ${validRecords.length} student records?`)) return;

    button.disabled = true;
    button.textContent = "Importing...";

    let success = 0;
    let failed = 0;

    for (const record of validRecords) {
      try {
        await API.post("/api/users", record.data);
        success++;
      } catch (e) {
        failed++;
        record.error = e.message || "Import failed";
      }
    }

    button.textContent = "Import students";

    message.textContent =
      `Import finished: ${success} successful, ${failed} failed, ` +
      `${csvRecords.length - validRecords.length} skipped.`;

    if (success > 0) {
      await load();
      notify(`${success} students imported successfully`);
    }

    showCSVPreview();

    // Keep the result visible until the administrator closes it.
    document.getElementById("csvSummary").textContent =
      `Import complete · ${success} successful · ${failed} failed · ` +
      `${csvRecords.length - validRecords.length} skipped`;

    button.disabled = true;
  };

  load();
}
