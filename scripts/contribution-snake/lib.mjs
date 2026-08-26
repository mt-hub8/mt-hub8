const CELL_SIZE = 16;
const DOT_SIZE = 12;
const INITIAL_LENGTH = 4;

export const contributionLevels = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

export const palettes = {
  light: {
    empty: "#ebedf0",
    border: "#1b1f230a",
    colors: ["#ebedf0", "#b7f0c2", "#73d68a", "#2da44e", "#116329"],
  },
  dark: {
    empty: "#161b22",
    border: "#ffffff0d",
    colors: ["#161b22", "#b8f7d0", "#6fdd97", "#2fbf71", "#0f6b3a"],
  },
};

const keyOf = ({ x, y }) => `${x},${y}`;
const samePoint = (a, b) => a.x === b.x && a.y === b.y;
const directions = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

export function calendarToGrid(calendar) {
  const width = calendar.weeks.length;
  const height = 7;
  const byPosition = new Map();

  calendar.weeks.forEach((week, x) => {
    week.contributionDays.forEach((day) => {
      byPosition.set(`${x},${day.weekday}`, {
        level: contributionLevels[day.contributionLevel] ?? 0,
        count: day.contributionCount,
        date: day.date,
      });
    });
  });

  const cells = [];
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const day = byPosition.get(`${x},${y}`);
      cells.push({
        x,
        y,
        level: day?.level ?? 0,
        count: day?.count ?? 0,
        date: day?.date ?? null,
      });
    }
  }

  return { width, height, cells };
}

export function createInitialBody() {
  return Array.from({ length: INITIAL_LENGTH }, (_, index) => ({
    x: -1 - index,
    y: 3,
    level: 4,
  }));
}

function advanceBody(body, nextHead, growLevel = null) {
  const positions = [nextHead, ...body.map(({ x, y }) => ({ x, y }))];
  const levels = body.map(({ level }) => level);

  if (growLevel !== null) levels.push(growLevel);
  else positions.pop();

  return positions.map((position, index) => ({
    ...position,
    level: levels[index],
  }));
}

const serializeBody = (body) =>
  body.map(({ x, y }) => `${x.toString(36)}.${y.toString(36)}`).join(";");

class MinHeap {
  #items = [];

  get size() {
    return this.#items.length;
  }

  push(value) {
    this.#items.push(value);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#items[parent].score <= value.score) break;
      this.#items[index] = this.#items[parent];
      index = parent;
    }
    this.#items[index] = value;
  }

  pop() {
    const first = this.#items[0];
    const last = this.#items.pop();
    if (this.#items.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#items.length) break;
      const child =
        right < this.#items.length &&
        this.#items[right].score < this.#items[left].score
          ? right
          : left;
      if (this.#items[child].score >= last.score) break;
      this.#items[index] = this.#items[child];
      index = child;
    }
    this.#items[index] = last;
    return first;
  }
}

const unwrapPath = (node) => {
  const path = [];
  for (let current = node; current?.parent; current = current.parent) {
    path.push(current.head);
  }
  return path.reverse();
};

function findBodyPath(
  body,
  { bounds, distanceToTarget, growsAtTarget, isTarget, label },
) {
  const queue = new MinHeap();
  const initialDistance = distanceToTarget(body[0]);
  queue.push({
    body,
    parent: null,
    head: body[0],
    steps: 0,
    score: initialDistance * 1_001,
  });
  const visited = new Map([[serializeBody(body), 0]]);

  while (queue.size > 0) {
    const state = queue.pop();
    const head = state.body[0];

    for (const direction of directions) {
      const next = { x: head.x + direction.x, y: head.y + direction.y };
      if (
        next.x < bounds.minX ||
        next.x > bounds.maxX ||
        next.y < bounds.minY ||
        next.y > bounds.maxY
      ) {
        continue;
      }

      const reachesTarget = isTarget(next);

      // The tail leaves on a normal step, but stays in place on a growth step.
      const collisionLength = reachesTarget && growsAtTarget
        ? state.body.length
        : state.body.length - 1;
      if (state.body.slice(0, collisionLength).some((part) => samePoint(part, next))) {
        continue;
      }

      const nextBody = advanceBody(state.body, next);
      const serialized = serializeBody(nextBody);
      const steps = state.steps + 1;
      if ((visited.get(serialized) ?? Infinity) <= steps) continue;

      const distance = distanceToTarget(next);
      const nextState = {
        body: nextBody,
        parent: state,
        head: next,
        steps,
        // Prefer progress toward the target when several states share the same
        // A* cost. This avoids exploring thousands of equivalent snake shapes.
        score: (steps + distance) * 1_000 + distance,
      };
      if (reachesTarget) return unwrapPath(nextState);

      visited.set(serialized, steps);
      queue.push(nextState);
    }

    if (visited.size > 250_000) {
      throw new Error(`Route search exceeded its safety limit while finding ${label}`);
    }
  }

  throw new Error(`No collision-free route found for ${label}`);
}

function findPathToHighestPriority(body, pending, level, bounds) {
  const targets = Array.from(pending.values()).filter((cell) => cell.level === level);
  return findBodyPath(body, {
    bounds,
    growsAtTarget: true,
    isTarget: (point) => pending.get(keyOf(point))?.level === level,
    distanceToTarget: ({ x, y }) =>
      Math.min(...targets.map((target) => Math.abs(target.x - x) + Math.abs(target.y - y))),
    label: `contribution level ${level}`,
  });
}

function findPathToPoint(body, target, bounds) {
  return findBodyPath(body, {
    bounds,
    growsAtTarget: false,
    isTarget: (point) => samePoint(point, target),
    distanceToTarget: ({ x, y }) => Math.abs(target.x - x) + Math.abs(target.y - y),
    label: `final staging point ${keyOf(target)}`,
  });
}

export function planSnake(grid) {
  const pending = new Map(
    grid.cells.filter(({ level }) => level > 0).map((cell) => [keyOf(cell), cell]),
  );
  const contributionCount = pending.size;
  const routingMargin = Math.max(6, Math.ceil(Math.sqrt(contributionCount)) + 2);
  const bounds = {
    minX: -routingMargin,
    maxX: grid.width - 1 + routingMargin,
    minY: -routingMargin,
    maxY: grid.height - 1 + routingMargin,
  };

  let body = createInitialBody();
  const frames = [{ body: structuredClone(body), eaten: null }];
  const eatenLevels = [];

  while (pending.size > 0) {
    const level = Math.max(...Array.from(pending.values(), ({ level }) => level));
    const path = findPathToHighestPriority(body, pending, level, bounds);

    for (const nextHead of path) {
      const candidate = pending.get(keyOf(nextHead));
      const eaten = candidate?.level === level ? candidate : null;
      body = advanceBody(body, nextHead, eaten?.level ?? null);

      if (eaten) {
        pending.delete(keyOf(eaten));
        eatenLevels.push(eaten.level);
      }

      frames.push({ body: structuredClone(body), eaten });
    }
  }

  // Finish in a straight, fully visible pose below the contribution grid. The
  // body enters this row from below, so sweeping left cannot cross itself.
  const leftAnchor = {
    x: -body.length - 4,
    y: grid.height + body.length + 4,
  };
  const rightAnchor = {
    x: grid.width + body.length * 2,
    y: leftAnchor.y,
  };
  const rowEntry = { x: rightAnchor.x, y: grid.height };
  const finalBounds = {
    minX: leftAnchor.x - 4,
    maxX: rightAnchor.x + 4,
    minY: -routingMargin,
    maxY: leftAnchor.y + 4,
  };
  const followPath = (path) => {
    for (const nextHead of path) {
      body = advanceBody(body, nextHead);
      frames.push({ body: structuredClone(body), eaten: null });
    }
  };
  followPath(findPathToPoint(body, leftAnchor, finalBounds));
  followPath(findPathToPoint(body, rightAnchor, finalBounds));
  followPath(findPathToPoint(body, rowEntry, finalBounds));
  const finalHeadX = grid.width - body.length;
  followPath(
    Array.from({ length: rowEntry.x - finalHeadX }, (_, index) => ({
      x: rowEntry.x - index - 1,
      y: grid.height,
    })),
  );

  const plan = { frames, eatenLevels, initialLength: INITIAL_LENGTH };
  validatePlan(plan, contributionCount);
  return plan;
}

export function validatePlan(plan, contributionCount) {
  const finalBody = plan.frames.at(-1).body;

  if (plan.eatenLevels.length !== contributionCount) {
    throw new Error("The route did not eat every contribution cell");
  }
  if (finalBody.length !== plan.initialLength + contributionCount) {
    throw new Error("The snake did not grow exactly once per eaten cell");
  }
  if (plan.eatenLevels.some((level, index, all) => index > 0 && all[index - 1] < level)) {
    throw new Error("Contribution cells were not eaten from darkest to lightest");
  }
  if (finalBody.some(({ level }, index, all) => index > 0 && all[index - 1].level < level)) {
    throw new Error("Final snake colors are not ordered from dark head to light tail");
  }

  for (const [frameIndex, { body }] of plan.frames.entries()) {
    if (new Set(body.map(keyOf)).size !== body.length) {
      throw new Error(`The snake collided with itself at frame ${frameIndex}`);
    }
    for (let index = 1; index < body.length; index += 1) {
      const distance =
        Math.abs(body[index - 1].x - body[index].x) +
        Math.abs(body[index - 1].y - body[index].y);
      if (distance !== 1) {
        throw new Error(`The snake body became disconnected at frame ${frameIndex}`);
      }
    }
  }

  return true;
}

const percentage = (index, length) => `${((index / (length - 1)) * 100).toFixed(4)}%`;

function simplifyTrajectory(points) {
  return points.filter((point, index, all) => {
    if (index === 0 || index === all.length - 1) return true;
    const previous = all[index - 1];
    const next = all[index + 1];
    const before = {
      x: point.x - previous.x,
      y: point.y - previous.y,
    };
    const after = { x: next.x - point.x, y: next.y - point.y };
    return before.x !== after.x || before.y !== after.y;
  });
}

const transform = ({ x, y }) =>
  `transform:translate(${x * CELL_SIZE}px,${y * CELL_SIZE}px)`;

function createSnakeCss(timeline, segmentIndex) {
  const birth = timeline.findIndex(({ body }) => body.length > segmentIndex);
  const first = timeline[birth].body[segmentIndex];
  const points = timeline.slice(birth).map((frame, offset) => ({
    ...frame.body[segmentIndex],
    index: birth + offset,
  }));
  const simplified = simplifyTrajectory(points);
  const keyframes = [];

  if (birth > 0) {
    keyframes.push(`0%,${percentage(Math.max(0, birth - 1), timeline.length)}{${transform(first)};opacity:0}`);
  }

  for (const point of simplified) {
    keyframes.push(
      `${percentage(point.index, timeline.length)}{${transform(point)};opacity:1}`,
    );
  }

  return `@keyframes s${segmentIndex}{${keyframes.join("")}}`;
}

function gridCellSvg(cell, eatenAt, timelineLength) {
  const className = eatenAt === undefined ? "c" : `c c${cell.x}_${cell.y}`;
  const animation =
    eatenAt === undefined
      ? ""
      : `@keyframes c${cell.x}_${cell.y}{0%,${percentage(
          Math.max(0, eatenAt - 1),
          timelineLength,
        )}{fill:var(--c${cell.level})}${percentage(eatenAt, timelineLength)},100%{fill:var(--ce)}}`;

  return {
    element: `<rect class="${className} l${cell.level}" x="${cell.x * CELL_SIZE + 2}" y="${cell.y * CELL_SIZE + 2}" rx="2" ry="2"/>`,
    animation,
  };
}

function progressAnimation(timeline) {
  const eaten = timeline
    .map((frame, index) => (frame.eaten ? index : -1))
    .filter((index) => index >= 0);
  if (eaten.length === 0) return "@keyframes progress{0%,100%{transform:scaleX(0)}}";

  const frames = ["0%{transform:scaleX(0)}"];
  eaten.forEach((frameIndex, index) => {
    const before = percentage(Math.max(0, frameIndex - 1), timeline.length);
    const at = percentage(frameIndex, timeline.length);
    frames.push(`${before}{transform:scaleX(${(index / eaten.length).toFixed(4)})}`);
    frames.push(`${at}{transform:scaleX(${((index + 1) / eaten.length).toFixed(4)})}`);
  });
  frames.push("100%{transform:scaleX(1)}");
  return `@keyframes progress{${frames.join("")}}`;
}

function compactFramesForAnimation(frames, grid) {
  const isVisible = ({ body }) =>
    body.some(
      ({ x, y }) =>
        x >= -1 && x <= grid.width && y >= -1 && y <= grid.height,
    );

  return frames.filter((frame, index, all) => {
    if (
      index === 0 ||
      index === all.length - 1 ||
      frame.eaten ||
      isVisible(frame)
    ) {
      return true;
    }

    // Off-screen straight runs need only their endpoints. Retaining turns keeps
    // the interpolated route outside the visible contribution area.
    const previous = all[index - 1].body[0];
    const current = frame.body[0];
    const next = all[index + 1].body[0];
    return (
      current.x - previous.x !== next.x - current.x ||
      current.y - previous.y !== next.y - current.y
    );
  });
}

export function renderSvg(grid, plan, paletteName, options = {}) {
  const palette = palettes[paletteName];
  if (!palette) throw new Error(`Unknown palette: ${paletteName}`);

  const startHoldFrames = options.startHoldFrames ?? 7;
  const endHoldFrames = options.endHoldFrames ?? 18;
  const animationFrames = compactFramesForAnimation(plan.frames, grid);
  const first = animationFrames[0];
  const last = animationFrames.at(-1);
  const timeline = [
    ...Array.from({ length: startHoldFrames }, () => first),
    ...animationFrames,
    ...Array.from({ length: endHoldFrames }, () => last),
  ];
  const stepDurationMs =
    options.stepDurationMs ?? Math.min(120, 24_000 / timeline.length);
  const duration = timeline.length * stepDurationMs;
  const maxLength = last.body.length;
  const finalLevels = last.body.map(({ level }) => level);

  const eatenAt = new Map();
  timeline.forEach((frame, index) => {
    if (frame.eaten) eatenAt.set(keyOf(frame.eaten), index);
  });

  const gridParts = grid.cells.map((cell) =>
    gridCellSvg(cell, eatenAt.get(keyOf(cell)), timeline.length),
  );
  const snakeElements = Array.from({ length: maxLength }, (_, index) => {
    const isHead = index === 0;
    const size = isHead ? 14.4 : DOT_SIZE;
    const inset = (CELL_SIZE - size) / 2;
    return `<rect class="s s${index} l${finalLevels[index]}${isHead ? " head" : ""}" x="${inset.toFixed(1)}" y="${inset.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="${isHead ? "4.5" : "3.2"}" ry="${isHead ? "4.5" : "3.2"}"/>`;
  });
  const snakeCss = Array.from({ length: maxLength }, (_, index) =>
    createSnakeCss(timeline, index),
  );

  const colorVariables = palette.colors
    .map((color, level) => `--c${level}:${color};`)
    .join("");
  const styles = [
    `:root{--ce:${palette.empty};--cb:${palette.border};${colorVariables}}`,
    `.c{shape-rendering:geometricPrecision;fill:var(--ce);stroke:var(--cb);stroke-width:1px;width:${DOT_SIZE}px;height:${DOT_SIZE}px}`,
    ...[1, 2, 3, 4].map((level) => `.l${level}{fill:var(--c${level})}`),
    ...gridParts.map(({ animation }) => animation).filter(Boolean),
    ...grid.cells
      .filter((cell) => eatenAt.has(keyOf(cell)))
      .map(
        (cell) =>
          `.c.c${cell.x}_${cell.y}{animation:c${cell.x}_${cell.y} ${duration}ms linear infinite}`,
      ),
    `.s{shape-rendering:geometricPrecision;opacity:0;animation-duration:${duration}ms;animation-timing-function:linear;animation-iteration-count:infinite}`,
    ...snakeCss,
    ...Array.from(
      { length: maxLength },
      (_, index) => `.s.s${index}{animation-name:s${index}}`,
    ),
    progressAnimation(timeline),
    `.progress{transform-origin:0 0;animation:progress ${duration}ms linear infinite}`,
  ].join("");

  const width = (grid.width + 2) * CELL_SIZE;
  const height = (grid.height + 5) * CELL_SIZE;
  const progressWidth = grid.width * CELL_SIZE;
  const progressY = (grid.height + 2) * CELL_SIZE;

  return [
    `<svg viewBox="-${CELL_SIZE} -${CELL_SIZE * 2} ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    "<desc>Contribution snake that grows on every cell and finishes dark-to-light from head to tail</desc>",
    `<defs><linearGradient id="progressGradient"><stop offset="0" stop-color="${palette.colors[4]}"/><stop offset="1" stop-color="${palette.colors[1]}"/></linearGradient></defs>`,
    `<style>${styles}</style>`,
    ...gridParts.map(({ element }) => element),
    `<rect class="progress" x="0" y="${progressY}" width="${progressWidth}" height="${DOT_SIZE}" fill="url(#progressGradient)"/>`,
    ...snakeElements,
    "</svg>",
  ].join("");
}
