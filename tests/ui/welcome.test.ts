import { describe, expect, it } from "vitest";
import { firstName, queueWelcome, takeWelcome } from "../../src/services/welcome";

describe("welcome toast queue", () => {
  it("uses the first word of the name", () => {
    expect(firstName("Ganesh Biyyapu")).toBe("Ganesh");
    expect(firstName("  ravi  ")).toBe("ravi");
  });

  it("greets once per sign-in", () => {
    expect(takeWelcome()).toBeNull();
    queueWelcome("Ganesh Biyyapu", "github");
    expect(takeWelcome()).toEqual({ name: "Ganesh", via: "github" });
    expect(takeWelcome()).toBeNull(); // refresh / remount does not greet again
  });
});
