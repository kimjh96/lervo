//! Conversation item positions, identifiers, and pages (protocol `conversation.range`).
//!
//! An item's identifier encodes its position, so the host finds any item without a map that grows
//! with the conversation.

/// Items per conversation segment.
pub const ITEMS_PER_SEGMENT: u64 = 256;

/// The most items one page returns.
pub const MAX_PAGE_ITEMS: u64 = 200;

/// Where an item sits: its segment and its slot within the segment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Location {
    pub segment: u64,
    pub slot: u64,
}

/// The location of the item at zero-based `position`.
pub fn locate(position: u64) -> Location {
    Location {
        segment: position / ITEMS_PER_SEGMENT,
        slot: position % ITEMS_PER_SEGMENT,
    }
}

/// The opaque identifier of the item at `position`.
pub fn item_id(position: u64) -> String {
    format!("i{position:x}")
}

/// The position an identifier names, if this host issued it.
pub fn position_of(item_id: &str) -> Option<u64> {
    let digits = item_id.strip_prefix('i')?;
    if digits.is_empty() || digits.len() > 16 || digits.starts_with('0') && digits.len() > 1 {
        return None;
    }
    u64::from_str_radix(digits, 16).ok()
}

/// Which side of the anchor a page covers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Before,
    After,
}

/// Items `[start, end)` and whether more exist on either side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Page {
    pub start: u64,
    pub end: u64,
    pub has_earlier: bool,
    pub has_later: bool,
}

/// Why a page could not be computed. The host answers with `range_invalid`.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum RangeError {
    #[error("range_invalid: anchor not in the conversation")]
    AnchorUnknown,
    #[error("range_invalid: limit must be between 1 and {MAX_PAGE_ITEMS}")]
    Limit,
}

/// The page of a conversation with `total` items. Without an anchor, `Before` returns the newest
/// items and `After` the oldest.
pub fn page(
    total: u64,
    anchor: Option<&str>,
    direction: Direction,
    limit: u64,
) -> Result<Page, RangeError> {
    if limit == 0 || limit > MAX_PAGE_ITEMS {
        return Err(RangeError::Limit);
    }
    let anchor = match anchor {
        None => None,
        Some(item) => match position_of(item) {
            Some(position) if position < total => Some(position),
            _ => return Err(RangeError::AnchorUnknown),
        },
    };
    let (start, end) = match (direction, anchor) {
        (Direction::Before, Some(position)) => (position.saturating_sub(limit), position),
        (Direction::Before, None) => (total.saturating_sub(limit), total),
        (Direction::After, Some(position)) => (
            position + 1,
            position.saturating_add(1).saturating_add(limit).min(total),
        ),
        (Direction::After, None) => (0, limit.min(total)),
    };
    Ok(Page {
        start,
        end,
        has_earlier: start > 0,
        has_later: end < total,
    })
}

#[cfg(test)]
mod tests {
    use super::{Direction, Location, Page, RangeError, item_id, locate, page, position_of};

    #[test]
    fn locates_items_by_segment_and_slot() {
        assert_eq!(
            locate(0),
            Location {
                segment: 0,
                slot: 0
            }
        );
        assert_eq!(
            locate(255),
            Location {
                segment: 0,
                slot: 255
            }
        );
        assert_eq!(
            locate(256),
            Location {
                segment: 1,
                slot: 0
            }
        );
    }

    #[test]
    fn round_trips_identifiers_and_rejects_foreign_ones() {
        for position in [0, 1, 255, 4096, u64::MAX] {
            assert_eq!(position_of(&item_id(position)), Some(position));
        }
        for foreign in ["", "i", "x1", "i01", "itm_1", "i10000000000000000", "iZ"] {
            assert_eq!(position_of(foreign), None, "{foreign}");
        }
    }

    #[test]
    fn pages_the_newest_items_without_an_anchor() {
        assert_eq!(
            page(1000, None, Direction::Before, 200),
            Ok(Page {
                start: 800,
                end: 1000,
                has_earlier: true,
                has_later: false
            })
        );
        assert_eq!(
            page(10, None, Direction::Before, 200),
            Ok(Page {
                start: 0,
                end: 10,
                has_earlier: false,
                has_later: false
            })
        );
    }

    #[test]
    fn pages_around_an_anchor() {
        let anchor = item_id(500);
        assert_eq!(
            page(1000, Some(&anchor), Direction::Before, 100),
            Ok(Page {
                start: 400,
                end: 500,
                has_earlier: true,
                has_later: true
            })
        );
        assert_eq!(
            page(1000, Some(&anchor), Direction::After, 100),
            Ok(Page {
                start: 501,
                end: 601,
                has_earlier: true,
                has_later: true
            })
        );
        assert_eq!(
            page(502, Some(&anchor), Direction::After, 100),
            Ok(Page {
                start: 501,
                end: 502,
                has_earlier: true,
                has_later: false
            })
        );
    }

    #[test]
    fn rejects_unknown_anchors_and_limits() {
        assert_eq!(
            page(10, Some("i10"), Direction::Before, 5),
            Err(RangeError::AnchorUnknown)
        );
        assert_eq!(
            page(10, Some("foreign"), Direction::Before, 5),
            Err(RangeError::AnchorUnknown)
        );
        assert_eq!(page(10, None, Direction::Before, 0), Err(RangeError::Limit));
        assert_eq!(
            page(10, None, Direction::Before, 201),
            Err(RangeError::Limit)
        );
    }
}
