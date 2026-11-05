import { InvalidArgumentError } from "commander";

// Commander argument parsers shared by command groups. They live apart from any command module so a
// group can use them without importing another group's registrar, and with it the registry.

/** A `YYYY-MM-DD` option value; any other shape is an argument error. */
export function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidArgumentError("date must use YYYY-MM-DD");
  return value;
}

/** An integer option value of at least `minimum`. */
export function integerOption(minimum: number): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum) throw new InvalidArgumentError(`must be an integer of at least ${minimum}.`);
    return parsed;
  };
}
