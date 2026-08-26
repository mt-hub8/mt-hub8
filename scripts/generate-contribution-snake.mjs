#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { calendarToGrid, planSnake, renderSvg } from "./contribution-snake/lib.mjs";

const login = process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN;

if (!login) throw new Error("GITHUB_REPOSITORY_OWNER is required");
if (!token) throw new Error("GITHUB_TOKEN is required");

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "mt-hub8-contribution-snake",
  },
  body: JSON.stringify({
    query: `
      query ContributionCalendar($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              weeks {
                contributionDays {
                  contributionCount
                  contributionLevel
                  date
                  weekday
                }
              }
            }
          }
        }
      }
    `,
    variables: { login },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed: ${response.status} ${await response.text()}`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(`GitHub GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
}

const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
if (!calendar) throw new Error(`No contribution calendar found for ${login}`);

const grid = calendarToGrid(calendar);
const plan = planSnake(grid);

await mkdir("dist", { recursive: true });
await Promise.all([
  writeFile(
    "dist/github-contribution-grid-snake.svg",
    renderSvg(grid, plan, "light"),
  ),
  writeFile(
    "dist/github-contribution-grid-snake-dark.svg",
    renderSvg(grid, plan, "dark"),
  ),
]);

console.log(
  `Generated two SVGs for ${login}: ${plan.eatenLevels.length} cells, ` +
    `${plan.frames.at(-1).body.length} snake segments, darkest-to-lightest.`,
);
