import { defineConfig } from "vitest/config";

const globalThreshold = {
  functions: 80,
  lines: 80,
  statements: 80
};

const parserWorkflowThreshold = {
  lines: 90,
  statements: 90
};

const validatorThreshold = {
  ...parserWorkflowThreshold,
  functions: 90
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/cli/**/*.ts",
        "src/core/mutation/**/*.ts",
        "src/core/parser/**/*.ts",
        "src/core/validator/**/*.ts",
        "src/core/workflow/**/*.ts",
        "src/mcp/**/*.ts"
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        ...globalThreshold,
        "src/core/mutation/**/*.ts": {
          functions: 90
        },
        "src/core/parser/**/*.ts": parserWorkflowThreshold,
        "src/core/validator/**/*.ts": validatorThreshold,
        "src/core/workflow/**/*.ts": parserWorkflowThreshold
      }
    }
  }
});
