import { httpRouter } from "convex/server";
import { jwks } from "./jwks";

const http = httpRouter();

http.route({
  path: "/.well-known/jwks.json",
  method: "GET",
  handler: jwks,
});

export default http;
