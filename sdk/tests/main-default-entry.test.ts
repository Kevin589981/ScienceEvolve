import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";
import * as main from "../src/main.js";
describe("main/default entry", () => {
  it("aliases the actual main SDK/config implementation, never auto-selects the old engine", () => {
    expect(root.createResearchSdk).toBe(main.createMainResearchSdk);
    expect(root.validateWorkflowConfig).toBe(main.validateMainWorkflowConfig);
    expect(root.loadWorkflowConfig).toBe(main.loadMainWorkflowConfig);
    expect(root.defaultWorkflowConfig().git.enabled).toBe(false);
  });
});
