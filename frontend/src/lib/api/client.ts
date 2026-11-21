import type { SentinelApi } from "./contract";
import { createHttpApi } from "./http-api";
import { mockApi } from "./mock-api";

/** Set VITE_SENTINEL_API_URL to point the UI at the FastAPI backend; otherwise mock data is used. */
const baseUrl = import.meta.env["VITE_SENTINEL_API_URL"] as string | undefined;

export const api: SentinelApi = baseUrl ? createHttpApi(baseUrl) : mockApi;
export const usingMockApi = !baseUrl;
