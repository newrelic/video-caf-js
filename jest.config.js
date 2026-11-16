module.exports = {
  testEnvironment: "jsdom",
  moduleFileExtensions: ["js", "jsx"],
  transform: { "^.+\\.jsx?$": "babel-jest" },
  moduleNameMapper: {
    "^@newrelic/video-core$": "<rootDir>/node_modules/@newrelic/video-core/__mock__.js",
  },
  testMatch: ["**/__test__/**/*.js?(x)", "**/?(*.)+(spec|test).js?(x)"],
};
