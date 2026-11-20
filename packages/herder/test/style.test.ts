import { describe, expect, it } from "vitest";
import { withoutEndPeriods } from "../src/style.ts";

describe("chat style (ADR 0088)", () => {
  it("drops the 。 that ends a line, keeps the ones inside", () => {
    expect(withoutEndPeriods("现在 11 点 33 分；感冒了就别熬太晚，把药吃了、早点歇。")).toBe(
      "现在 11 点 33 分；感冒了就别熬太晚，把药吃了、早点歇",
    );
    expect(withoutEndPeriods("做完了。清单在 ~/notes.md。\n\n- 第一项。\n- 第二项")).toBe(
      "做完了。清单在 ~/notes.md\n\n- 第一项\n- 第二项",
    );
    expect(withoutEndPeriods("好的。。  ")).toBe("好的  ");
  });

  it("leaves code and herd-ui blocks as they are", () => {
    const block = '```herd-ui\n{"items":[{"type":"text","content":"完成。"}]}\n```';
    expect(withoutEndPeriods(`看下面。\n${block}\n就这些。`)).toBe(`看下面\n${block}\n就这些`);
    expect(withoutEndPeriods("```\necho 。\n```")).toBe("```\necho 。\n```");
  });
});
