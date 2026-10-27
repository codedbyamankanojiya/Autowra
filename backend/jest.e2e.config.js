/**
 * End-to-end test configuration. These suites use the real Nest application
 * and the PostgreSQL database named by TEST_DATABASE_URL / DATABASE_URL.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/e2e/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }],
  },
  testEnvironment: 'node',
  testTimeout: 120000,
  setupFilesAfterEnv: ['<rootDir>/test/e2e/setup.ts'],
};
