export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        app: "nieuwjaar",
        environment: env.ENVIRONMENT || "development"
      });
    }

    return env.ASSETS.fetch(request);
  }
};
