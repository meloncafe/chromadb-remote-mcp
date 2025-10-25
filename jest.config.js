/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  projects: [
    // Unit tests configuration
    {
      displayName: "unit",
      preset: "ts-jest/presets/default-esm",
      testEnvironment: "node",
      setupFiles: ["<rootDir>/tests/unit/setup.ts"],
      roots: ["<rootDir>/src", "<rootDir>/tests/unit"],
      testMatch: ["**/tests/unit/**/*.test.ts"],
      moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
      collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/**/*.test.ts",
        "!src/types.ts", // Interface definitions only - no runtime code to test
        "!**/node_modules/**",
      ],
      coverageDirectory: "coverage/unit",
      coverageReporters: ["text", "lcov", "html", "json"],
      coverageThreshold: {
        global: {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "./src/chroma-tools.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "./src/index.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
      moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
      },
      extensionsToTreatAsEsm: [".ts"],
      transformIgnorePatterns: [
        "node_modules/(?!(supertest|superagent|formidable|@paralleldrive/cuid2)/)",
      ],
      transform: {
        "^.+\\.tsx?$": [
          "ts-jest",
          {
            useESM: true,
            tsconfig: {
              module: "ESNext",
              moduleResolution: "node",
            },
          },
        ],
      },
      testTimeout: 10000,
    },
  ],
  // Codecov Test Analytics integration (applies to all projects)
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: ".",
        outputName: "junit.xml",
        classNameTemplate: "{filepath}",
        titleTemplate: "{title}",
        ancestorSeparator: " › ",
        usePathForSuiteName: true,
      },
    ],
  ],
};
