
const Auth = {
    saveTokens(d) {
        const access =
            d.access_token ||
            d.accessToken ||
            d.token;

        const refresh =
            d.refresh_token ||
            d.refreshToken;

        if (access) {
            localStorage.setItem("sa_access", access);
        }

        if (refresh) {
            localStorage.setItem("sa_refresh", refresh);
        }

        if (d.user || d.admin) {
            localStorage.setItem(
                "sa_user",
                JSON.stringify(d.user || d.admin)
            );
        }
    },

    logout(redirect = true) {
        [
            "sa_access",
            "sa_refresh",
            "sa_user"
        ].forEach(key => localStorage.removeItem(key));

        if (redirect) {
            location.href = "login.html";
        }
    },

    redirectIfAuthenticated() {
        if (localStorage.getItem("sa_access")) {
            location.href = "dashboard.html";
        }
    },

    guard() {
        if (!localStorage.getItem("sa_access")) {
            location.href = "login.html";
            return false;
        }

        let user = {};

        try {
            user = JSON.parse(
                localStorage.getItem("sa_user") || "{}"
            );
        } catch (e) {
            user = {};
        }

        const n = document.getElementById("adminName");

        if (n) {
            n.textContent =
                user.name ||
                user.username ||
                user.email ||
                "Administrator";
        }

        document.querySelectorAll("[data-nav]").forEach(a => {
            if (location.pathname.endsWith(a.dataset.nav)) {
                a.classList.add("active");
            }
        });

        document.getElementById("logoutBtn")
            ?.addEventListener("click", () => Auth.logout());

        document.getElementById("menuBtn")
            ?.addEventListener("click", () => {
                document.querySelector(".sidebar")
                    ?.classList.toggle("open");
            });

        return true;
    },

    bindLogin() {
        if (localStorage.getItem("sa_access")) {
            location.href = "dashboard.html";
            return;
        }

        const form = document.getElementById("loginForm");

        if (!form) return;

        form.addEventListener("submit", async e => {
            e.preventDefault();

            const f = new FormData(form);
            const err = document.getElementById("loginError");
            const btn = form.querySelector("button");

            btn.disabled = true;
            btn.textContent = "Signing in...";
            err.textContent = "";

            try {
                // Correct Cloudflare Worker admin login endpoint
                const d = await API.post(
                    "/api/admin/login",
                    {
                        email: f.get("identity"),
                        username: f.get("identity"),
                        identity: f.get("identity"),
                        password: f.get("password")
                    }
                );

                Auth.saveTokens(d);

                if (!localStorage.getItem("sa_access")) {
                    throw new Error(
                        "Login succeeded but no access token was found. " +
                        "Please check the Worker login response."
                    );
                }

                location.href = "dashboard.html";

            } catch (x) {
                err.textContent = x.message ||
                    "Unable to sign in. Please try again.";

            } finally {
                btn.disabled = false;
                btn.textContent = "Sign in";
            }
        });
    }
};
