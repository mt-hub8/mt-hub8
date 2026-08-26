import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarToGrid,
  planSnake,
  renderSvg,
  validatePlan,
} from "./contribution-snake/lib.mjs";

const makeGrid = (targets) => ({
  width: 8,
  height: 7,
  cells: Array.from({ length: 8 * 7 }, (_, index) => {
    const x = Math.floor(index / 7);
    const y = index % 7;
    return { x, y, level: targets.get(`${x},${y}`) ?? 0 };
  }),
});

test("calendar data is normalized to a complete seven-row grid", () => {
  const grid = calendarToGrid({
    weeks: [
      {
        contributionDays: [
          {
            weekday: 2,
            contributionCount: 7,
            contributionLevel: "THIRD_QUARTILE",
            date: "2026-08-25",
          },
        ],
      },
    ],
  });

  assert.equal(grid.cells.length, 7);
  assert.equal(grid.cells.find(({ y }) => y === 2).level, 3);
  assert.equal(grid.cells.find(({ y }) => y === 1).level, 0);
});

test("the snake eats dark cells first, grows, and ends dark-to-light", () => {
  const grid = makeGrid(
    new Map([
      ["1,1", 1],
      ["2,5", 4],
      ["4,2", 2],
      ["6,4", 3],
      ["7,0", 4],
    ]),
  );
  const plan = planSnake(grid);

  assert.deepEqual(plan.eatenLevels, [4, 4, 3, 2, 1]);
  assert.equal(plan.frames.at(-1).body.length, 9);
  assert.deepEqual(
    plan.frames.at(-1).body.map(({ level }) => level),
    [4, 4, 4, 4, 4, 4, 3, 2, 1],
  );
  assert.deepEqual(
    [...new Set(plan.frames.at(-1).body.map(({ y }) => y))],
    [grid.height],
  );
  assert.equal(validatePlan(plan, 5), true);
});

test("lighter cells can be crossed without being eaten before a surrounded dark cell", () => {
  const grid = makeGrid(
    new Map([
      ["3,3", 4],
      ["2,3", 1],
      ["4,3", 1],
      ["3,2", 1],
      ["3,4", 1],
    ]),
  );
  const plan = planSnake(grid);

  assert.deepEqual(plan.eatenLevels, [4, 1, 1, 1, 1]);
  assert.deepEqual(
    plan.frames.at(-1).body.map(({ level }) => level),
    [4, 4, 4, 4, 4, 1, 1, 1, 1],
  );
});

test("SVG contains per-segment colors, growth animation, and final hold", () => {
  const grid = makeGrid(
    new Map([
      ["2,2", 4],
      ["5,4", 1],
    ]),
  );
  const plan = planSnake(grid);
  const svg = renderSvg(grid, plan, "light", {
    startHoldFrames: 2,
    endHoldFrames: 3,
  });

  assert.match(svg, /finishes dark-to-light/);
  assert.match(svg, /class="s s0 l4 head"/);
  assert.match(svg, /class="s s5 l1"/);
  assert.match(svg, /@keyframes progress/);
  assert.doesNotMatch(svg, /undefined|NaN/);
});
