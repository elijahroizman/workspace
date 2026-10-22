//! Excel's dates: a number of days, with the time of day as the fraction.
//!
//! In the 1900 system (Excel's default) day 1 is 1 January 1900, and day 60 is 29 February 1900,
//! a day that never was: Lotus 1-2-3 thought 1900 was a leap year, and Excel kept the mistake
//! so old files would agree. In the 1904 system (old Mac Excel) day 0 is 1 January 1904.

/// A calendar date and time of day.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct DateTime {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    /// Thousandths of a second.
    pub milli: u32,
}

impl DateTime {
    pub fn date(year: i32, month: u32, day: u32) -> DateTime {
        DateTime { year, month, day, hour: 0, minute: 0, second: 0, milli: 0 }
    }

    /// Monday is 1, Sunday 7.
    pub fn weekday(&self) -> u32 {
        // Day 0 of `days_from_civil` (1970-01-01) was a Thursday.
        ((days_from_civil(self.year, self.month, self.day) + 3).rem_euclid(7) + 1) as u32
    }
}

/// Which day a workbook counts from (`workbookPr date1904`).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum DateSystem {
    #[default]
    From1900,
    From1904,
}

/// Days from 1970-01-01 to a date in the proleptic Gregorian calendar (Howard Hinnant's method).
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y as i64 - 1 } else { y as i64 };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y as i32, m, d)
}

/// 1899-12-30 and 1904-01-01, as days from 1970.
const EPOCH_1900: i64 = -25_569;
const EPOCH_1904: i64 = -24_107;

/// The date and time a serial number stands for, or `None` for one Excel can't show (negative,
/// or past 9999).
pub fn from_serial(serial: f64, system: DateSystem) -> Option<DateTime> {
    if !(0.0..2_958_466.0).contains(&serial) {
        return None;
    }
    let mut days = serial.floor() as i64;
    // Round to the millisecond, carrying into the next day when it rounds up to midnight.
    let mut ms = ((serial - serial.floor()) * 86_400_000.0).round() as i64;
    if ms >= 86_400_000 {
        ms -= 86_400_000;
        days += 1;
    }
    let (y, m, d) = match system {
        DateSystem::From1904 => civil_from_days(EPOCH_1904 + days),
        // The day that never was, and day 0, which Excel shows as 0 January 1900.
        DateSystem::From1900 if days == 60 => (1900, 2, 29),
        DateSystem::From1900 if days == 0 => (1900, 1, 0),
        DateSystem::From1900 if days < 60 => civil_from_days(EPOCH_1900 + days + 1),
        DateSystem::From1900 => civil_from_days(EPOCH_1900 + days),
    };
    let ms = ms as u32;
    Some(DateTime { year: y, month: m, day: d, hour: ms / 3_600_000, minute: ms / 60_000 % 60, second: ms / 1000 % 60, milli: ms % 1000 })
}

/// The serial number for a date and time.
pub fn to_serial(dt: DateTime, system: DateSystem) -> f64 {
    let time = (dt.hour as f64 * 3600.0 + dt.minute as f64 * 60.0 + dt.second as f64 + dt.milli as f64 / 1000.0) / 86_400.0;
    let days = match system {
        DateSystem::From1904 => days_from_civil(dt.year, dt.month, dt.day) - EPOCH_1904,
        DateSystem::From1900 if (dt.year, dt.month, dt.day) == (1900, 2, 29) => 60,
        DateSystem::From1900 => {
            let d = days_from_civil(dt.year, dt.month, dt.day) - EPOCH_1900;
            // Before the day that never was, Excel's numbers are one lower.
            if d <= 60 {
                d - 1
            } else {
                d
            }
        }
    };
    days as f64 + time
}

/// Excel's DATE: months and days past the end of their range roll over, as they do in Excel.
pub fn date(year: i64, month: i64, day: i64, system: DateSystem) -> f64 {
    // Years 0–1899 mean 1900–3799.
    let year = if (0..1900).contains(&year) { year + 1900 } else { year };
    if !(1900..=9999).contains(&year) {
        return f64::NAN;
    }
    let Some(months) = year.checked_mul(12).and_then(|y| y.checked_add(month)).and_then(|m| m.checked_sub(1)) else {
        return f64::NAN;
    };
    let (y, m) = (months.div_euclid(12), months.rem_euclid(12) + 1);
    let Ok(y) = i32::try_from(y) else {
        return f64::NAN;
    };
    let first = to_serial(DateTime::date(y, m as u32, 1), system);
    let Some(offset) = day.checked_sub(1) else {
        return f64::NAN;
    };
    let serial = first + offset as f64;
    let max = to_serial(DateTime::date(9999, 12, 31), system);
    if (0.0..=max).contains(&serial) {
        serial
    } else {
        f64::NAN
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excel_serials() {
        let s = DateSystem::From1900;
        assert_eq!(from_serial(1.0, s), Some(DateTime::date(1900, 1, 1)));
        assert_eq!(from_serial(59.0, s), Some(DateTime::date(1900, 2, 28)));
        assert_eq!(from_serial(60.0, s), Some(DateTime::date(1900, 2, 29)));
        assert_eq!(from_serial(61.0, s), Some(DateTime::date(1900, 3, 1)));
        assert_eq!(from_serial(45_000.0, s), Some(DateTime::date(2023, 3, 15)));
        let noon = from_serial(45_000.5, s).unwrap();
        assert_eq!((noon.hour, noon.minute), (12, 0));
        assert_eq!(to_serial(DateTime::date(2023, 3, 15), s), 45_000.0);
        assert_eq!(to_serial(DateTime::date(1900, 1, 1), s), 1.0);
        assert_eq!(to_serial(DateTime::date(1900, 3, 1), s), 61.0);
        assert_eq!(from_serial(0.0, DateSystem::From1904), Some(DateTime::date(1904, 1, 1)));
        assert_eq!(to_serial(DateTime::date(2023, 3, 15), DateSystem::From1904), 45_000.0 - 1462.0);
        assert_eq!(from_serial(-1.0, s), None);
        // 23:59:59.9996 rounds to the next midnight.
        assert_eq!(from_serial(1.999_999_999_9, s), Some(DateTime::date(1900, 1, 2)));
    }

    #[test]
    fn date_rolls_over() {
        let s = DateSystem::From1900;
        assert_eq!(date(2023, 13, 1, s), to_serial(DateTime::date(2024, 1, 1), s));
        assert_eq!(date(2023, 3, 0, s), to_serial(DateTime::date(2023, 2, 28), s));
        assert_eq!(date(123, 1, 1, s), to_serial(DateTime::date(2023, 1, 1), s));
        assert_eq!(DateTime::date(2023, 3, 15).weekday(), 3);
    }
}
