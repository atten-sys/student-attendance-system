// Backend implementation reference only. The existing deployed Worker remains
// the live API. This scaffold is intentionally not deployed by the frontend ZIP.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return Response.json({ status: "ok" });
    }
    return Response.json({ error: "Route not implemented in this scaffold" }, { status: 501 });
  }
};
