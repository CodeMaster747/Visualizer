/**
 * Bundled snippets.
 *
 * These are the same scenarios the tracer is tested on, so "load an example and
 * press Visualize" doubles as a smoke test of the whole pipeline.
 */

import type { SampleFile } from "./api";
import type { Language } from "../store/prefs";

export interface Example {
  id: string;
  label: string;
  hint: string;
  source: string;
  files?: SampleFile[];
}

const SALES_CSV = `region,amount,quarter
north,120,Q1
south,340,Q1
north,260,Q2
east,90,Q2
south,410,Q3
north,175,Q3
`;

const PYTHON_EXAMPLES: Example[] = [
  {
    id: "aliasing",
    label: "Aliasing",
    hint: "two names, one list",
    source: `a = [1, 2, 3]
b = a
c = list(a)

a.append(4)
b[0] = 99

print(a, b, c)
`,
  },
  {
    id: "recursion",
    label: "Recursion",
    hint: "nested call frames",
    source: `def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

result = fact(5)
print(result)
`,
  },
  {
    id: "classes",
    label: "Classes & cycles",
    hint: "objects pointing at each other",
    source: `class Node:
    def __init__(self, value):
        self.value = value
        self.next = None

    def __repr__(self):
        return f"Node({self.value})"

a = Node("first")
b = Node("second")
a.next = b
b.next = a
`,
  },
  {
    id: "pandas",
    label: "pandas + numpy",
    hint: "real libraries, uploaded data",
    // Uploaded files are read by bare name -- the tracer runs each snippet in
    // its own private directory, so there is no shared path to get wrong.
    source: `import pandas as pd
import numpy as np

df = pd.read_csv("sales.csv")
totals = df.groupby("region")["amount"].sum()

arr = np.array([[1, 2], [3, 4]])
scaled = arr * 10

print(totals)
`,
    files: [{ name: "sales.csv", content: SALES_CSV }],
  },
  {
    id: "error",
    label: "Exception",
    hint: "partial trace up to the throw",
    source: `def divide(a, b):
    return a / b

x = divide(10, 2)
y = divide(10, 0)
`,
  },
];

const JAVA_EXAMPLES: Example[] = [
  {
    id: "statements",
    label: "Basics",
    hint: "bare statements, auto-wrapped",
    source: `int[] nums = {3, 1, 2};
int sum = 0;
for (int n : nums) {
    sum += n;
}
System.out.println("sum = " + sum);
`,
  },
  {
    id: "recursion",
    label: "Recursion",
    hint: "nested call frames",
    source: `public class Main {
    static int fact(int n) {
        if (n <= 1) return 1;
        return n * fact(n - 1);
    }

    public static void main(String[] args) {
        int result = fact(5);
        System.out.println(result);
    }
}
`,
  },
  {
    id: "objects",
    label: "Objects & refs",
    hint: "instances pointing at each other",
    source: `public class Main {
    static class Node {
        int value;
        Node next;
        Node(int value) { this.value = value; }
    }

    public static void main(String[] args) {
        Node a = new Node(1);
        Node b = new Node(2);
        a.next = b;
        b.next = a;
    }
}
`,
  },
  {
    id: "error",
    label: "Exception",
    hint: "partial trace up to the throw",
    source: `public class Main {
    public static void main(String[] args) {
        int[] a = {10, 20};
        int total = 0;
        for (int i = 0; i <= a.length; i++) {
            total += a[i];
        }
    }
}
`,
  },
];

const JAVASCRIPT_EXAMPLES: Example[] = [
  {
    id: "aliasing",
    label: "Aliasing",
    hint: "two names, one array",
    source: `const a = [1, 2, 3];
const b = a;
const c = [...a];

a.push(4);
b[0] = 99;

console.log(a, b, c);
`,
  },
  {
    id: "closures",
    label: "Closures",
    hint: "a function that keeps its state",
    source: `function counter() {
  let count = 0;
  return () => {
    count += 1;
    return count;
  };
}

const next = counter();
const first = next();
const second = next();

console.log(first, second);
`,
  },
  {
    id: "objects",
    label: "Classes & cycles",
    hint: "objects pointing at each other",
    source: `class Node {
  constructor(value) {
    this.value = value;
    this.next = null;
  }
}

const a = new Node("first");
const b = new Node("second");
a.next = b;
b.next = a;
`,
  },
  {
    id: "callbacks",
    label: "map & filter",
    hint: "callbacks the runtime calls back into",
    source: `const nums = [1, 2, 3, 4, 5];

const doubled = nums.map((n) => n * 2);
const evens = doubled.filter((n) => n % 4 === 0);
const total = evens.reduce((sum, n) => sum + n, 0);

console.log(doubled, evens, total);
`,
  },
  {
    id: "collections",
    label: "Map & Set",
    hint: "keyed and unique collections",
    source: `const seen = new Set();
const counts = new Map();

for (const word of ["red", "blue", "red"]) {
  seen.add(word);
  counts.set(word, (counts.get(word) ?? 0) + 1);
}

console.log([...seen], counts.get("red"));
`,
  },
  {
    id: "error",
    label: "Exception",
    hint: "partial trace up to the throw",
    source: `function divide(a, b) {
  if (b === 0) throw new RangeError("cannot divide by zero");
  return a / b;
}

const x = divide(10, 2);
const y = divide(10, 0);
`,
  },
];

const TYPESCRIPT_EXAMPLES: Example[] = [
  {
    id: "types",
    label: "Types & interfaces",
    hint: "annotations erased at runtime",
    source: `interface Point {
  x: number;
  y: number;
}

function shift(p: Point, by: number): Point {
  return { x: p.x + by, y: p.y + by };
}

const origin: Point = { x: 0, y: 0 };
const moved = shift(origin, 5);

console.log(moved);
`,
  },
  {
    id: "generics",
    label: "Generics",
    hint: "one function, several shapes",
    source: `function last<T>(items: T[]): T | undefined {
  return items[items.length - 1];
}

const nums: number[] = [1, 2, 3];
const words: string[] = ["a", "b"];

const lastNum = last(nums);
const lastWord = last(words);

console.log(lastNum, lastWord);
`,
  },
  {
    id: "classes",
    label: "Classes",
    hint: "fields, methods and references",
    source: `class Account {
  private balance = 0;

  constructor(readonly owner: string) {}

  deposit(amount: number): number {
    this.balance += amount;
    return this.balance;
  }
}

const acc = new Account("ada");
acc.deposit(50);
acc.deposit(25);
`,
  },
  {
    id: "error",
    label: "Exception",
    hint: "partial trace up to the throw",
    source: `function parse(input: string): number {
  const value = Number(input);
  if (Number.isNaN(value)) throw new TypeError(\`not a number: \${input}\`);
  return value;
}

const ok = parse("42");
const bad = parse("nope");
`,
  },
];

export const EXAMPLES: Record<Language, Example[]> = {
  python: PYTHON_EXAMPLES,
  java: JAVA_EXAMPLES,
  javascript: JAVASCRIPT_EXAMPLES,
  typescript: TYPESCRIPT_EXAMPLES,
};
