/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["next/core-web-vitals"],
  rules: {
    "@next/next/no-html-link-for-pages": "warn",
    "react/no-unescaped-entities": "warn",
  },
};
