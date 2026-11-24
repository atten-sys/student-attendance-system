
if (Auth.guard()) {
  let stream = null;
  let detector = null;
  let raf = null;

  let students = [];
  let scanning = false;
  let detecting = false;
  let submitting = false;

  // Prevent the same QR code from being submitted repeatedly
  let lastScannedToken = "";
  let qrDisappearedFrames = 0;

  const video = document.getElementById("camera");
  const status = document.getElementById("scanStatus");
  const result = document.getElementById("scanResult");

  const startButton = document.getElementById("startScan");
  const stopButton = document.getElementById("stopScan");

  // ---------- LOAD STUDENTS ----------
  async function load() {
    try {
      students = rows(await API.get("/api/users"));

      document.getElementById("manualStudent").innerHTML =
        '<option value="">Select student</option>' +
        students.map(s => `
          <option value="${esc(s.id)}">
            ${esc(
              (s.first_name || s.name || s.full_name || "") +
              " " +
              (s.last_name || "") +
              " · " +
              (s.student_number || s.student_id || s.id)
            )}
          </option>
        `).join("");

    } catch (e) {
      console.error("Unable to load students:", e);
    }

    refresh();
  }

  // ---------- SUBMIT QR TOKEN ----------
  async function submitToken(token, action) {
    if (!token || submitting) return false;

    submitting = true;

    try {
      const d = await API.post("/api/attendance/scan", {
        token,
        action: action || "auto"
      });

      const studentName =
        d.student?.fullName ||
        d.student?.full_name ||
        d.student?.name ||
        d.student_name ||
        d.name ||
        "Student identified";

      result.innerHTML = `
        <b>${esc(studentName)}</b><br>
        ${esc(d.message || "Attendance recorded successfully")}
      `;

      status.textContent =
        scanning
          ? "Attendance recorded. Camera is ready for the next student."
          : "Attendance recorded.";

      notify("Attendance recorded");

      refresh();

      return true;

    } catch (e) {
      result.textContent = e.message || "Unable to record attendance.";

      status.textContent =
        scanning
          ? "Scan unsuccessful. Camera is still active. Ready for the next student."
          : "Scan unsuccessful.";

      notify(e.message || "Attendance recording failed.");

      return false;

    } finally {
      submitting = false;
    }
  }

  // ---------- CONTINUOUS QR SCANNING ----------
  async function tick() {
    if (!scanning || !stream || !detector || detecting) {
      return;
    }

    detecting = true;

    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await detector.detect(video);

        if (!scanning) return;

        if (codes.length && codes[0].rawValue) {
          const token = codes[0].rawValue.trim();

          if (token) {
            qrDisappearedFrames = 0;

            // Ignore the same QR while it remains in front
            if (token !== lastScannedToken && !submitting) {
              lastScannedToken = token;

              status.textContent = "QR detected. Recording attendance...";

              await submitToken(token);
            }
          }

        } else {
          // QR code is no longer visible
          qrDisappearedFrames++;

          // Allow the previous QR to be scanned again only
          // after it has disappeared for several detection frames.
          if (qrDisappearedFrames >= 8) {
            lastScannedToken = "";
            qrDisappearedFrames = 0;
          }
        }
      }

    } catch (e) {
      console.warn("QR detection error:", e);
    } finally {
      detecting = false;
    }

    // IMPORTANT: Continue scanning without stopping the camera
    if (scanning) {
      raf = requestAnimationFrame(tick);
    }
  }

  // ---------- START CAMERA ----------
  async function start() {
    if (scanning || stream) return;

    try {
      if (!("BarcodeDetector" in window)) {
        throw new Error(
          "QR camera scanning is not supported by this browser. " +
          "Use a supported version of Chrome or enter the QR token manually."
        );
      }

      detector = new BarcodeDetector({
        formats: ["qr_code"]
      });

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment"
        },
        audio: false
      });

      video.srcObject = stream;
      await video.play();

      scanning = true;

      lastScannedToken = "";
      qrDisappearedFrames = 0;

      startButton.disabled = true;
      stopButton.disabled = false;

      status.textContent =
        "Camera active — point it at a student QR code.";

      tick();

    } catch (e) {
      status.textContent = e.message;

      console.error("Camera error:", e);

      // Clean up if camera startup fails
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      stream = null;
      scanning = false;

      video.srcObject = null;

      startButton.disabled = false;
      stopButton.disabled = true;
    }
  }

  // ---------- STOP CAMERA ----------
  async function stop() {
    scanning = false;

    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    video.pause();
    video.srcObject = null;

    detector = null;

    lastScannedToken = "";
    qrDisappearedFrames = 0;

    startButton.disabled = false;
    stopButton.disabled = true;

    status.textContent = "Camera is off.";
  }

  // ---------- REFRESH TODAY'S ATTENDANCE ----------
  async function refresh() {
    try {
      const d = await API.get(
        "/api/attendance?date=" +
        new Date().toISOString().slice(0, 10)
      );

      const a = rows(d);

      document.getElementById("todayAttendance").innerHTML =
        a.length
          ? `
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Action</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${a.map(x => `
                  <tr>
                    <td>${esc(
                      x.student_name ||
                      x.name ||
                      x.student_id
                    )}</td>
                    <td>${esc(x.action || x.type || "—")}</td>
                    <td>${esc(x.time || x.created_at || "—")}</td>
                    <td>${esc(x.status || "Recorded")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          `
          : '<p class="muted">No attendance records found.</p>';

    } catch (e) {
      document.getElementById("todayAttendance").textContent =
        "Attendance API is not available yet: " + e.message;
    }
  }

  // ---------- BUTTON EVENTS ----------
  startButton.onclick = start;
  stopButton.onclick = stop;

  document.getElementById("refreshAttendance").onclick = refresh;

  // ---------- MANUAL QR TOKEN SUBMISSION ----------
  document.getElementById("tokenForm").onsubmit = async e => {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const token = form.get("token");

    const success = await submitToken(token);

    if (success) {
      e.currentTarget.reset();
    }
  };

  // ---------- MANUAL ATTENDANCE ----------
  document.getElementById("manualForm").onsubmit = async e => {
    e.preventDefault();

    const form = new FormData(e.currentTarget);

    try {
      const d = await API.post("/api/attendance/manual", {
        student_id: form.get("student_id"),
        action: form.get("action")
      });

      result.textContent =
        d.message || "Attendance recorded successfully.";

      notify("Attendance recorded");

      refresh();

    } catch (x) {
      result.textContent = x.message;
      notify(x.message);
    }
  };

  // ---------- INITIALIZE ----------
  load();

  window.addEventListener("beforeunload", stop);
}
