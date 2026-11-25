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
      const message = e?.message || "Unable to load students.";
      const table = document.getElementById("studentTable");

      if (message.toLowerCase().includes("failed to fetch")) {
        table.innerHTML =
          '<p class="error">Cannot connect to the attendance API. ' +
          'Check config.js for the correct Worker URL, then verify that ' +
          'the Worker is deployed and its CORS settings allow this website.</p>';
        console.error("Student API connection failed:", e);
      } else {
        table.textContent = message;
      }
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
              <button class="table-action" data-view-record="${esc(s.id)}">View Record</button>
              <button class="table-action" data-qr="${esc(s.id)}">QR Code</button>
              <button class="table-action" data-edit="${esc(s.id)}">Edit</button>
              <button class="table-action" data-delete="${esc(s.id)}">Delete</button>
            </td>
          </tr>
        `).join("") +
        "</tbody></table>"
      : '<p class="muted">No matching students.</p>';

    document.querySelectorAll("[data-view-record]").forEach(b =>
      b.onclick = () => viewStudentRecord(b.dataset.viewRecord)
    );

    document.querySelectorAll("[data-qr]").forEach(b =>
      b.onclick = () => generateStudentQR(b.dataset.qr)
    );

    document.querySelectorAll("[data-edit]").forEach(b =>
      b.onclick = () => edit(b.dataset.edit)
    );

    document.querySelectorAll("[data-delete]").forEach(b =>
      b.onclick = () => remove(b.dataset.delete)
    );
  }

  // ---------- PER-STUDENT ATTENDANCE RECORD ----------
  const recordDialog = document.createElement("dialog");
  recordDialog.className = "dialog";
  recordDialog.style.width = "min(950px, 96%)";
  recordDialog.style.maxWidth = "950px";
  recordDialog.innerHTML = `
    <div class="panel-head">
      <div>
        <h2 style="margin:0">Student Attendance Record</h2>
        <p id="recordStudentName" class="muted" style="margin:4px 0 0"></p>
      </div>
      <button type="button" class="icon-btn" id="closeStudentRecord" aria-label="Close">✕</button>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin:16px 0">
      <label>From<br><input type="date" id="recordFrom" class="input"></label>
      <label>To<br><input type="date" id="recordTo" class="input"></label>
      <button type="button" class="btn primary" id="loadStudentRecord">View</button>
    </div>
    <div id="recordSummary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0"></div>
    <p id="recordNotice" class="muted" style="font-size:12px"></p>
    <div style="overflow:auto;max-height:420px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th>Date</th><th>Time in</th><th>Time out</th><th>Status</th><th>Late minutes</th><th>Notes</th></tr></thead>
        <tbody id="studentRecordRows"><tr><td colspan="6">Choose a date range.</td></tr></tbody>
      </table>
    </div>
    <div class="dialog-actions"><button type="button" class="btn secondary" id="doneStudentRecord">Close</button></div>
    <p id="studentRecordError" class="error"></p>
  `;
  document.body.appendChild(recordDialog);

  let currentRecordStudent = null;

  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  const monthStartLocal = () => todayLocal().slice(0, 8) + "01";

  document.getElementById("closeStudentRecord").onclick =
  document.getElementById("doneStudentRecord").onclick = () => recordDialog.close();

  document.getElementById("loadStudentRecord").onclick = () => loadStudentRecord();

  async function viewStudentRecord(id) {
    currentRecordStudent = students.find(s => String(s.id) === String(id));

    if (!currentRecordStudent) return notify("Student record not found.");

    const name = currentRecordStudent.full_name || currentRecordStudent.name ||
      [currentRecordStudent.first_name, currentRecordStudent.last_name].filter(Boolean).join(" ");

    document.getElementById("recordStudentName").textContent =
      `${name} · ${currentRecordStudent.student_number || currentRecordStudent.student_id || ""}`;

    document.getElementById("recordFrom").value = monthStartLocal();
    document.getElementById("recordTo").value = todayLocal();
    document.getElementById("studentRecordError").textContent = "";

    recordDialog.showModal();
    await loadStudentRecord();
  }

  function countWeekdays(from, to) {
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    let count = 0;

    for (const d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    }

    return count;
  }

  function formatAttendanceTime(value) {
    if (!value) return "—";

    const d = new Date(value);

    return Number.isNaN(d.getTime())
      ? String(value)
      : d.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
  }

  async function loadStudentRecord() {
    if (!currentRecordStudent) return;

    const from = document.getElementById("recordFrom").value;
    const to = document.getElementById("recordTo").value;
    const tbody = document.getElementById("studentRecordRows");
    const error = document.getElementById("studentRecordError");
    const summaryBox = document.getElementById("recordSummary");

    error.textContent = "";

    if (!from || !to || from > to) {
      error.textContent = "Please select a valid date range.";
      return;
    }

    tbody.innerHTML = '<tr><td colspan="6">Loading attendance records...</td></tr>';
    summaryBox.innerHTML = "";

    try {
      const report = await API.get(
        `/api/reports/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );

      const allRecords = report.records || report.data || [];

      const records = allRecords.filter(
        r => Number(r.student_id) === Number(currentRecordStudent.id)
      );

      const present = records.filter(r => r.status === "present").length;
      const late = records.filter(r => r.status === "late").length;
      const excused = records.filter(r => r.status === "excused").length;

      const attended = new Set(records.map(r => r.attendance_date));

      // Absent is inferred from weekdays with no attendance row.
      const absent = Math.max(0, countWeekdays(from, to) - attended.size);

      const cards = [
        ["Present", present, "#16834a"],
        ["Late", late, "#c47b08"],
        ["Absent", absent, "#c43d3d"],
        ["Excused", excused, "#64748b"]
      ];

      summaryBox.innerHTML = cards.map(([label, value, color]) => `
        <div style="border:1px solid var(--border,#ddd);border-radius:10px;padding:12px">
          <div class="muted" style="font-size:12px">${label}</div>
          <div style="font-size:26px;font-weight:700;color:${color}">${value}</div>
        </div>
      `).join("");

      document.getElementById("recordNotice").textContent =
        "Absent is estimated as Monday–Friday dates without an attendance record. School holidays and non-class days are not automatically excluded.";

      const ordered = records.slice().sort(
        (a, b) => String(b.attendance_date).localeCompare(String(a.attendance_date))
      );

      tbody.innerHTML = ordered.length ? ordered.map(r => `
        <tr>
          <td>${esc(r.attendance_date || "—")}</td>
          <td>${esc(formatAttendanceTime(r.time_in))}</td>
          <td>${esc(formatAttendanceTime(r.time_out))}</td>
          <td><span class="pill">${esc((r.status || "unknown").toUpperCase())}</span></td>
          <td>${esc(r.late_minutes ?? 0)}</td>
          <td>${esc(r.notes || "—")}</td>
        </tr>
      `).join("") : '<tr><td colspan="6">No attendance records found for this date range.</td></tr>';

    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6">Unable to load attendance records.</td></tr>';
      error.textContent = e.message || "Attendance report request failed.";
    }
  }

  // ---------- STUDENT QR CODE ----------
  const qrDialog = document.createElement("dialog");
  qrDialog.className = "dialog";
  qrDialog.style.maxWidth = "440px";
  qrDialog.style.width = "95%";

  qrDialog.innerHTML = `
    <div class="panel-head">
      <h2>Student QR Code</h2>
      <button type="button" class="icon-btn" id="closeStudentQR" aria-label="Close">✕</button>
    </div>
    <div style="text-align:center;padding:16px">
      <div id="studentQRCanvas" style="display:flex;justify-content:center;min-height:220px;align-items:center"></div>
      <h3 id="studentQRName" style="margin:12px 0 4px"></h3>
      <p id="studentQRNumber" class="muted" style="margin:0 0 12px"></p>
      <p class="muted" style="font-size:12px">Keep this QR code private. It is used to identify this student for attendance.</p>
    </div>
    <div class="dialog-actions">
      <button type="button" class="btn secondary" id="downloadStudentQR">Download PNG</button>
      <button type="button" class="btn secondary" id="printStudentQR">Print</button>
      <button type="button" class="btn primary" id="doneStudentQR">Done</button>
    </div>
    <p id="studentQRError" class="error"></p>
  `;

  document.body.appendChild(qrDialog);

  let currentQRStudent = null;

  document.getElementById("closeStudentQR").onclick =
  document.getElementById("doneStudentQR").onclick = () => qrDialog.close();

  async function generateStudentQR(id) {
    const student = students.find(s => String(s.id) === String(id));

    if (!student) return notify("Student record not found.");

    if (typeof QRCode === "undefined") {
      return notify("QR library is missing. Add the QRCode.js script to students.html.");
    }

    if (!confirm(`Generate a new QR code for ${student.full_name || student.name || student.student_id || "this student"}? Any previous QR code for this student will stop working.`)) return;

    const box = document.getElementById("studentQRCanvas");
    const error = document.getElementById("studentQRError");

    box.innerHTML = "Generating QR code...";
    error.textContent = "";
    currentQRStudent = student;

    qrDialog.showModal();

    try {
      const result = await API.post(
        `/api/users/${encodeURIComponent(id)}/qr-token`,
        {}
      );

      if (!result?.qrToken) {
        throw new Error(result?.message || "The API did not return a QR token.");
      }

      box.innerHTML = "";

      new QRCode(box, {
        text: result.qrToken,
        width: 240,
        height: 240,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });

      document.getElementById("studentQRName").textContent =
        result.student?.full_name || student.full_name || student.name ||
        [student.first_name, student.last_name].filter(Boolean).join(" ") || "Student";

      document.getElementById("studentQRNumber").textContent =
        result.student?.student_id || student.student_id || student.student_number || "";

    } catch (e) {
      box.textContent = "Unable to generate QR code.";
      error.textContent = e.message || "QR generation failed.";
    }
  }

  function getStudentQRImage() {
    const box = document.getElementById("studentQRCanvas");
    const canvas = box.querySelector("canvas");

    if (canvas) return canvas.toDataURL("image/png");

    const img = box.querySelector("img");

    return img?.src || null;
  }

  document.getElementById("downloadStudentQR").onclick = () => {
    const image = getStudentQRImage();

    if (!image) return notify("Generate a QR code first.");

    const link = document.createElement("a");
    const number = currentQRStudent?.student_id ||
      currentQRStudent?.student_number ||
      currentQRStudent?.id ||
      "student";

    link.href = image;
    link.download = `student-${number}-qr.png`;
    link.click();
  };

  document.getElementById("printStudentQR").onclick = () => {
    const image = getStudentQRImage();

    if (!image) return notify("Generate a QR code first.");

    const name = document.getElementById("studentQRName").textContent;
    const number = document.getElementById("studentQRNumber").textContent;

    const win = window.open("", "_blank", "width=500,height=650");

    if (!win) return notify("Allow pop-ups to print the QR code.");

    win.document.write(`<!doctype html><html><head><title>Student QR Code</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:30px}img{width:280px;height:280px}h2{margin-bottom:6px}</style></head><body><h2>${esc(name)}</h2><p>${esc(number)}</p><img src="${image}" alt="Student QR Code"><p>Student Attendance QR Code</p><script>window.onload=()=>window.print()<\/script></body></html>`);

    win.document.close();
  };

  // ---------- BULK STUDENT QR CODES ----------
  // Uses the same existing API endpoint as individual QR generation.
  // Generating a new token invalidates that student's previous QR code.
  const bulkQRButton = document.createElement("button");
  bulkQRButton.type = "button";
  bulkQRButton.className = "btn secondary";
  bulkQRButton.textContent = "Generate All QR Codes";
  bulkQRButton.id = "generateAllStudentQR";

  const addStudentButton = document.getElementById("addStudentBtn");
  if (addStudentButton?.parentElement) {
    addStudentButton.parentElement.insertBefore(
      bulkQRButton,
      addStudentButton.nextSibling
    );
  }

  const bulkQRDialog = document.createElement("dialog");
  bulkQRDialog.className = "dialog";
  bulkQRDialog.style.width = "min(1100px, 96%)";
  bulkQRDialog.style.maxWidth = "1100px";
  bulkQRDialog.innerHTML = `
    <div class="panel-head">
      <div>
        <h2 style="margin:0">All Student QR Codes</h2>
        <p id="bulkQRStatus" class="muted" style="margin:4px 0 0">Ready to generate.</p>
      </div>
      <button type="button" class="icon-btn" id="closeBulkStudentQR" aria-label="Close">✕</button>
    </div>
    <p class="muted" style="font-size:12px">
      Each QR code contains a private student token. Keep printed copies secure.
    </p>
    <div id="bulkQRGrid" style="
      display:grid;
      grid-template-columns:repeat(auto-fill,minmax(190px,1fr));
      gap:14px;
      max-height:65vh;
      overflow:auto;
      padding:8px 2px;
    "></div>
    <p id="bulkQRError" class="error"></p>
    <div class="dialog-actions">
      <button type="button" class="btn secondary" id="printAllStudentQR" disabled>Print All</button>
      <button type="button" class="btn primary" id="doneBulkStudentQR">Done</button>
    </div>
  `;
  document.body.appendChild(bulkQRDialog);

  let bulkQRImages = [];

  document.getElementById("closeBulkStudentQR").onclick =
  document.getElementById("doneBulkStudentQR").onclick = () => bulkQRDialog.close();

  function studentDisplayName(student) {
    return student.full_name || student.name ||
      [student.first_name, student.last_name].filter(Boolean).join(" ") ||
      "Student";
  }

  function studentDisplayNumber(student) {
    return student.student_number || student.student_id || student.id || "";
  }

  function createBulkQRCard(student, token) {
    const card = document.createElement("div");
    card.style.cssText =
      "border:1px solid var(--border,#ddd);border-radius:10px;padding:12px;" +
      "text-align:center;break-inside:avoid;background:#fff;color:#111;";

    const name = document.createElement("h3");
    name.textContent = studentDisplayName(student);
    name.style.cssText = "font-size:14px;margin:0 0 4px;";

    const number = document.createElement("p");
    number.textContent = studentDisplayNumber(student);
    number.style.cssText = "font-size:12px;margin:0 0 8px;color:#555;";

    const qrBox = document.createElement("div");
    qrBox.style.cssText =
      "display:flex;justify-content:center;align-items:center;min-height:160px;";

    card.append(name, number, qrBox);

    new QRCode(qrBox, {
      text: token,
      width: 160,
      height: 160,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    const canvas = qrBox.querySelector("canvas");
    const img = qrBox.querySelector("img");
    const image = canvas
      ? canvas.toDataURL("image/png")
      : (img?.src || null);

    if (!image) {
      throw new Error(`Could not create QR image for ${studentDisplayName(student)}.`);
    }

    return {
      card,
      image,
      name: studentDisplayName(student),
      number: studentDisplayNumber(student)
    };
  }

  async function generateAllStudentQR() {
    if (!students.length) {
      notify("There are no students to generate QR codes for.");
      return;
    }

    if (typeof QRCode === "undefined") {
      notify("QR library is missing. Add the QRCode.js script to students.html.");
      return;
    }

    const confirmed = confirm(
      `Generate new QR codes for all ${students.length} loaded students? ` +
      "This replaces each student's previous QR token, so old QR codes will stop working."
    );
    if (!confirmed) return;

    const grid = document.getElementById("bulkQRGrid");
    const status = document.getElementById("bulkQRStatus");
    const errorBox = document.getElementById("bulkQRError");
    const printButton = document.getElementById("printAllStudentQR");

    bulkQRImages = [];
    grid.innerHTML = "";
    errorBox.textContent = "";
    printButton.disabled = true;
    status.textContent = `Generating 0 of ${students.length}...`;
    bulkQRDialog.showModal();

    let succeeded = 0;
    const failures = [];

    for (let index = 0; index < students.length; index++) {
      const student = students[index];
      const id = student.id;

      try {
        if (id === undefined || id === null || id === "") {
          throw new Error("Student record has no database ID.");
        }

        const result = await API.post(
          `/api/users/${encodeURIComponent(id)}/qr-token`,
          {}
        );

        if (!result?.qrToken) {
          throw new Error(result?.message || "The API did not return a QR token.");
        }

        const item = createBulkQRCard(student, result.qrToken);
        grid.appendChild(item.card);
        bulkQRImages.push(item);
        succeeded++;
      } catch (e) {
        failures.push(
          `${studentDisplayName(student)} (${studentDisplayNumber(student)}): ` +
          (e.message || "QR generation failed")
        );
      }

      status.textContent =
        `Processed ${index + 1} of ${students.length} · ` +
        `${succeeded} generated · ${failures.length} failed`;
    }

    printButton.disabled = bulkQRImages.length === 0;

    if (failures.length) {
      errorBox.textContent =
        "Some QR codes could not be generated:\n" + failures.join("\n");
      errorBox.style.whiteSpace = "pre-line";
    } else {
      errorBox.textContent = "";
    }

    if (!succeeded) {
      status.textContent = "No QR codes were generated.";
    } else {
      status.textContent =
        `Finished: ${succeeded} QR codes generated` +
        (failures.length ? `, ${failures.length} failed.` : ".");
    }
  }

  bulkQRButton.onclick = generateAllStudentQR;

  document.getElementById("printAllStudentQR").onclick = () => {
    if (!bulkQRImages.length) {
      return notify("Generate the QR codes first.");
    }

    const win = window.open("", "_blank", "width=1000,height=800");
    if (!win) return notify("Allow pop-ups to print all QR codes.");

    const cards = bulkQRImages.map(item => `
      <article class="student-card">
        <h3>${safe(item.name)}</h3>
        <p>${safe(item.number)}</p>
        <img src="${item.image}" alt="QR code for ${safe(item.name)}">
        <small>Student Attendance QR Code</small>
      </article>
    `).join("");

    win.document.write(`<!doctype html>
      <html>
      <head>
        <title>All Student QR Codes</title>
        <style>
          *{box-sizing:border-box}
          body{font-family:Arial,sans-serif;margin:18px;color:#111}
          .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
          .student-card{
            border:1px solid #bbb;border-radius:8px;padding:12px;
            text-align:center;break-inside:avoid;page-break-inside:avoid
          }
          h3{font-size:14px;margin:0 0 4px}
          p{font-size:12px;margin:0 0 8px}
          img{display:block;width:150px;height:150px;object-fit:contain;margin:0 auto 6px}
          small{font-size:10px}
          @media print{
            body{margin:8mm}
            .grid{gap:8px}
            .student-card{border:1px solid #999}
            @page{size:A4 portrait;margin:10mm}
          }
        </style>
      </head>
      <body>
        <div class="grid">${cards}</div>
        <script>window.onload=()=>window.print();<\/script>
      </body>
      </html>`);
    win.document.close();
  };

  // ---------- EDIT STUDENT ----------
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

  // ---------- DELETE STUDENT ----------
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

  // ---------- ADD STUDENT ----------
  document.getElementById("addStudentBtn").onclick = () => {
    form.reset();
    form.elements.id.value = "";

    document.getElementById("studentDialogTitle").textContent = "Add student";

    dlg.showModal();
  };

  ["closeStudent", "cancelStudent"].forEach(id => {
    document.getElementById(id).onclick = () => dlg.close();
  });

  // ---------- SAVE STUDENT ----------
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

  // ---------- EXPORT STUDENTS ----------
  document.getElementById("exportStudents").onclick = () => {
    csvDownload("students.csv", students);
  };

  // ---------- CSV IMPORT UI ----------
  // Use the single Import CSV control already present in students.html.
  // Do not create another button or another file input here.
  const fileInput = document.getElementById("csvFileInput");

  if (!fileInput) {
    console.error(
      'CSV import input #csvFileInput was not found. Add it once in students.html.'
    );
  }

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

  // ---------- NORMALIZE CSV RECORD ----------
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

  // ---------- SHOW CSV PREVIEW ----------
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
      message.textContent = "There are no valid student records to import.";
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

  // ---------- INITIAL LOAD ----------
  load();
}
