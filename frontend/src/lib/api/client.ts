import { createHttpApi } from "./http-api";

export const api = createHttpApi(
  import.meta.env["VITE_SENTINEL_API_URL"] || "http://localhost:8000",
);
