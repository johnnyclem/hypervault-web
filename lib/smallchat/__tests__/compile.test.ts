import { describe, expect, it } from "vitest";
import { buildCapabilityHeader } from "@/lib/smallchat/compile";
import { toProviderManifest } from "@/lib/smallchat/introspect";

describe("buildCapabilityHeader", () => {
  it("summarizes each server as capability areas, not a per-tool list", () => {
    const manifest = toProviderManifest(
      { id: "srv-1", name: "contexta-mcp", url: "http://mcp.test/mcp" },
      [
        { name: "read_page", description: "Read a page", input_schema: { type: "object" } },
        { name: "create_page", description: "Create a page", input_schema: { type: "object" } },
        { name: "list_workspaces", description: "List workspaces", input_schema: { type: "object" } },
        { name: "get_workspace_tree", description: "Get the workspace tree", input_schema: { type: "object" } },
        { name: "list_tasks", description: "List tasks", input_schema: { type: "object" } },
        { name: "bulk_update_tasks", description: "Bulk update tasks", input_schema: { type: "object" } },
        { name: "manage_graph_node", description: "CRUD graph nodes", input_schema: { type: "object" } },
      ],
      []
    );
    const header = buildCapabilityHeader([manifest]);
    expect(header).toBe("- contexta-mcp: page, workspaces, tasks, graph");
    expect(header).not.toContain("read_page");
    expect(header).not.toContain("bulk_update_tasks");
    expect(header).not.toContain("args:");
  });

  it("folds plurals and multiple servers onto one line each", () => {
    const contexta = toProviderManifest(
      { id: "srv-1", name: "contexta-mcp", url: "http://mcp.test/mcp" },
      [
        { name: "list_reminders", description: "List reminders", input_schema: { type: "object" } },
        { name: "manage_reminder", description: "Manage a reminder", input_schema: { type: "object" } },
      ],
      []
    );
    const cloud = toProviderManifest(
      { id: "srv-2", name: "mcp", url: "http://run.test/mcp" },
      [
        { name: "list_services", description: "List services", input_schema: { type: "object" } },
        { name: "get_service", description: "Get a service", input_schema: { type: "object" } },
      ],
      []
    );
    const header = buildCapabilityHeader([contexta, cloud]);
    expect(header).toBe("- contexta-mcp: reminders\n- mcp: services");
  });

  it("omits servers whose every tool is disabled", () => {
    const manifest = toProviderManifest(
      { id: "srv-2", name: "Empty", url: "http://mcp.test/mcp" },
      [{ name: "only_tool", description: "does things", input_schema: { type: "object" } }],
      ["only_tool"]
    );
    expect(buildCapabilityHeader([manifest])).toBe("");
  });
});
