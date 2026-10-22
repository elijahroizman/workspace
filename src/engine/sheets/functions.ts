// The worksheet functions the engine works out (crates/office-sheets/src/eval.rs), for the
// formula editor's suggestions and argument hints. Keep this in step with eval.rs: a function
// listed here that the engine doesn't know gives #NAME?.

export interface SheetFunction {
  name: string
  /** Arguments as Excel writes them; optional ones in brackets. */
  args: string[]
  /** What it gives, in a short sentence. */
  about: string
  group: 'Maths' | 'Statistics' | 'Logic' | 'Text' | 'Lookup' | 'Date and time' | 'Information'
}

const f = (group: SheetFunction['group'], name: string, args: string[], about: string): SheetFunction => ({ name, args, about, group })

export const FUNCTIONS: SheetFunction[] = [
  f('Maths', 'SUM', ['number1', '[number2]', '…'], 'Adds numbers and ranges.'),
  f('Maths', 'PRODUCT', ['number1', '[number2]', '…'], 'Multiplies numbers together.'),
  f('Maths', 'SUMPRODUCT', ['array1', '[array2]', '…'], 'Multiplies matching items in ranges and adds the results.'),
  f('Maths', 'SUMIF', ['range', 'criteria', '[sum_range]'], 'Adds the cells that meet a condition.'),
  f('Maths', 'ABS', ['number'], 'The number without its sign.'),
  f('Maths', 'INT', ['number'], 'Rounds down to a whole number.'),
  f('Maths', 'SIGN', ['number'], '1 for positive, -1 for negative, 0 for zero.'),
  f('Maths', 'SQRT', ['number'], 'The square root.'),
  f('Maths', 'POWER', ['number', 'power'], 'A number raised to a power.'),
  f('Maths', 'MOD', ['number', 'divisor'], 'The remainder after dividing.'),
  f('Maths', 'ROUND', ['number', 'num_digits'], 'Rounds to a number of digits.'),
  f('Maths', 'ROUNDUP', ['number', 'num_digits'], 'Rounds away from zero.'),
  f('Maths', 'ROUNDDOWN', ['number', 'num_digits'], 'Rounds toward zero.'),
  f('Maths', 'PI', [], 'The number π.'),
  f('Maths', 'LN', ['number'], 'The natural logarithm.'),
  f('Maths', 'LOG10', ['number'], 'The base-10 logarithm.'),
  f('Maths', 'EXP', ['number'], 'e raised to a power.'),
  f('Statistics', 'AVERAGE', ['number1', '[number2]', '…'], 'The mean of the numbers.'),
  f('Statistics', 'AVERAGEIF', ['range', 'criteria', '[average_range]'], 'The mean of the cells that meet a condition.'),
  f('Statistics', 'MIN', ['number1', '[number2]', '…'], 'The smallest number.'),
  f('Statistics', 'MAX', ['number1', '[number2]', '…'], 'The largest number.'),
  f('Statistics', 'COUNT', ['value1', '[value2]', '…'], 'How many cells hold numbers.'),
  f('Statistics', 'COUNTA', ['value1', '[value2]', '…'], 'How many cells aren’t empty.'),
  f('Statistics', 'COUNTBLANK', ['range'], 'How many cells are empty.'),
  f('Statistics', 'COUNTIF', ['range', 'criteria'], 'How many cells meet a condition.'),
  f('Logic', 'IF', ['logical_test', '[value_if_true]', '[value_if_false]'], 'One value if a condition is true, another if it’s false.'),
  f('Logic', 'IFERROR', ['value', 'value_if_error'], 'A value, or another if it’s an error.'),
  f('Logic', 'IFNA', ['value', 'value_if_na'], 'A value, or another if it’s #N/A.'),
  f('Logic', 'AND', ['logical1', '[logical2]', '…'], 'TRUE if every argument is true.'),
  f('Logic', 'OR', ['logical1', '[logical2]', '…'], 'TRUE if any argument is true.'),
  f('Logic', 'XOR', ['logical1', '[logical2]', '…'], 'TRUE if an odd number of arguments are true.'),
  f('Logic', 'NOT', ['logical'], 'Reverses TRUE and FALSE.'),
  f('Logic', 'TRUE', [], 'The value TRUE.'),
  f('Logic', 'FALSE', [], 'The value FALSE.'),
  f('Information', 'ISBLANK', ['value'], 'TRUE if the cell is empty.'),
  f('Information', 'ISNUMBER', ['value'], 'TRUE if the value is a number.'),
  f('Information', 'ISTEXT', ['value'], 'TRUE if the value is text.'),
  f('Information', 'ISNONTEXT', ['value'], 'TRUE if the value isn’t text.'),
  f('Information', 'ISLOGICAL', ['value'], 'TRUE if the value is TRUE or FALSE.'),
  f('Information', 'ISERR', ['value'], 'TRUE for any error except #N/A.'),
  f('Information', 'ISERROR', ['value'], 'TRUE for any error.'),
  f('Information', 'ISNA', ['value'], 'TRUE if the value is #N/A.'),
  f('Information', 'NA', [], 'The #N/A error.'),
  f('Text', 'CONCAT', ['text1', '[text2]', '…'], 'Joins text together.'),
  f('Text', 'CONCATENATE', ['text1', '[text2]', '…'], 'Joins text together.'),
  f('Text', 'TEXTJOIN', ['delimiter', 'ignore_empty', 'text1', '…'], 'Joins text with a separator.'),
  f('Text', 'LEN', ['text'], 'How many characters.'),
  f('Text', 'UPPER', ['text'], 'Text in capitals.'),
  f('Text', 'LOWER', ['text'], 'Text in lower case.'),
  f('Text', 'PROPER', ['text'], 'Text With Each Word Capitalised.'),
  f('Text', 'TRIM', ['text'], 'Text without extra spaces.'),
  f('Text', 'LEFT', ['text', '[num_chars]'], 'Characters from the start.'),
  f('Text', 'RIGHT', ['text', '[num_chars]'], 'Characters from the end.'),
  f('Text', 'MID', ['text', 'start_num', 'num_chars'], 'Characters from the middle.'),
  f('Text', 'FIND', ['find_text', 'within_text', '[start_num]'], 'Where text starts (case-sensitive).'),
  f('Text', 'SEARCH', ['find_text', 'within_text', '[start_num]'], 'Where text starts (ignoring case, with wildcards).'),
  f('Text', 'SUBSTITUTE', ['text', 'old_text', 'new_text', '[instance_num]'], 'Replaces text with other text.'),
  f('Text', 'REPT', ['text', 'number_times'], 'Text repeated.'),
  f('Text', 'VALUE', ['text'], 'Text as a number.'),
  f('Text', 'TEXT', ['value', 'format_text'], 'A number as text in a format.'),
  f('Text', 'CHAR', ['number'], 'The character with a code.'),
  f('Text', 'CODE', ['text'], 'The code of the first character.'),
  f('Text', 'EXACT', ['text1', 'text2'], 'TRUE if two texts are exactly the same.'),
  f('Lookup', 'VLOOKUP', ['lookup_value', 'table_array', 'col_index_num', '[range_lookup]'], 'Finds a value in a table’s first column and gives one from its row.'),
  f('Lookup', 'HLOOKUP', ['lookup_value', 'table_array', 'row_index_num', '[range_lookup]'], 'Finds a value in a table’s first row and gives one from its column.'),
  f('Lookup', 'MATCH', ['lookup_value', 'lookup_array', '[match_type]'], 'Where a value is in a range.'),
  f('Lookup', 'INDEX', ['array', 'row_num', '[column_num]'], 'The value at a row and column of a range.'),
  f('Lookup', 'CHOOSE', ['index_num', 'value1', '[value2]', '…'], 'One value from a list, by number.'),
  f('Lookup', 'ROWS', ['array'], 'How many rows a range has.'),
  f('Lookup', 'COLUMNS', ['array'], 'How many columns a range has.'),
  f('Date and time', 'DATE', ['year', 'month', 'day'], 'A date from its year, month and day.'),
  f('Date and time', 'TIME', ['hour', 'minute', 'second'], 'A time from its parts.'),
  f('Date and time', 'YEAR', ['serial_number'], 'The year of a date.'),
  f('Date and time', 'MONTH', ['serial_number'], 'The month of a date, 1 to 12.'),
  f('Date and time', 'DAY', ['serial_number'], 'The day of the month.'),
  f('Date and time', 'WEEKDAY', ['serial_number'], 'The day of the week, 1 (Sunday) to 7.'),
  f('Date and time', 'HOUR', ['serial_number'], 'The hour of a time.'),
  f('Date and time', 'MINUTE', ['serial_number'], 'The minute of a time.'),
  f('Date and time', 'SECOND', ['serial_number'], 'The second of a time.'),
  f('Date and time', 'NOW', [], 'The date and time now.'),
  f('Date and time', 'TODAY', [], 'Today’s date.'),
]

/** Functions people reach for first, shown when nothing's typed yet. */
export const COMMON = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'ROUND', 'VLOOKUP', 'SUMIF', 'COUNTIF', 'CONCAT', 'TODAY']

export const functionByName = new Map(FUNCTIONS.map((fn) => [fn.name, fn]))
