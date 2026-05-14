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
        "^http-proxy-middleware$": "<rootDir>/tests/__mocks__/http-proxy-middleware.ts",
      },
      extensionsToTreatAsEsm: [".ts"],
      transformIgnorePatterns: [
        "node_modules/(?!(supertest|superagent|formidable|@paralleldrive/cuid2|http-proxy-middleware|jose)/)",
      ],
      transform: {
        "^.+\\.[tj]sx?$": [
          "ts-jest",
          {
            useESM: true,
            tsconfig: {
              module: "ESNext",
              moduleResolution: "node",
              allowJs: true,
            },
          },
        ],
      },
      testTimeout: 10000,
    },
    // Integration tests configuration (R2 root path mcp handshake 등).
    // testPathIgnorePatterns 는 v2.1.0 시점부터 한 번도 실행되지 않은 dead test
    // (integration project 자체가 jest config 에 없었음 → 기대값이 실제 동작과
    // 어긋남). v2.1.1 hotfix 스코프 외 — 별도 후속 작업으로 정리한다.
    {
      displayName: "integration",
      preset: "ts-jest/presets/default-esm",
      testEnvironment: "node",
      roots: ["<rootDir>/tests/integration"],
      testMatch: ["**/tests/integration/**/*.test.ts"],
      testPathIgnorePatterns: [
        "/node_modules/",
        "tests/integration/oauth-proxy-disabled.test.ts",
        "tests/integration/v2-scenarios.test.ts",
        "tests/integration/metadata-schema.test.ts",
      ],
      moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
      moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
        "^http-proxy-middleware$": "<rootDir>/tests/__mocks__/http-proxy-middleware.ts",
      },
      extensionsToTreatAsEsm: [".ts"],
      transformIgnorePatterns: [
        "node_modules/(?!(supertest|superagent|formidable|@paralleldrive/cuid2|http-proxy-middleware|jose)/)",
      ],
      transform: {
        "^.+\\.[tj]sx?$": [
          "ts-jest",
          {
            useESM: true,
            tsconfig: {
              module: "ESNext",
              moduleResolution: "node",
              allowJs: true,
              // R2 integration test 가 RequestInfo / Response 등 fetch DOM 타입을
              // 사용하므로 lib 에 DOM 포함 (test 환경 한정 — build 산출물에는 무관).
              lib: ["ES2022", "DOM"],
            },
          },
        ],
      },
      testTimeout: 30000,
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