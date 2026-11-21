// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./http-api";

const api = createHttpApi("http://sentinel.test/api/v1/");
afterEach(() => vi.unstubAllGlobals());

describe("FastAPI transport", () => {
  it("passes the selected identity, encodes search, and follows pagination", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ items: [{ id: "A" }], total: 2 }))
      .mockResolvedValueOnce(Response.json({ items: [{ id: "B" }], total: 2 }));
    vi.stubGlobal("fetch", fetch);
    expect(
      (await api.invoices("U013", { q: "A&B", status: "approval" })).map(({ id }) => id),
    ).toEqual(["A", "B"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [index, [url, init]] of fetch.mock.calls.entries()) {
      const target = new URL(url);
      expect(target.pathname).toBe("/api/v1/invoices");
      expect(target.searchParams.get("q")).toBe("A&B");
      expect(target.searchParams.get("status")).toBe("approval");
      expect(target.searchParams.get("offset")).toBe(String(index));
      expect(init.headers.get("X-Demo-User-Id")).toBe("U013");
    }
  });

  it("sends original upload bytes as multipart and surfaces backend errors", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const request = new Request(url, init);
      expect(request.method).toBe("POST");
      expect(new URL(url).pathname).toBe("/api/v1/invoices/upload");
      const body = await request.formData();
      const file = body.get("file") as File;
      expect(file.name).toBe("invoice.pdf");
      expect(await file.text()).toBe("%PDF-example");
      return Response.json(
        { error: { code: "UNSUPPORTED_FILE_TYPE", message: "Invalid file", details: {} } },
        { status: 422 },
      );
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      api.upload("U004", new File(["%PDF-example"], "invoice.pdf", { type: "application/pdf" })),
    ).rejects.toMatchObject({
      status: 422,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Invalid file",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
