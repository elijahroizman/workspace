//! Undo and redo. Each layer has its own kind of step (text splices, moved shapes, changed
//! cells) and its own kind of selection; the history keeps them in entries, joins a run of
//! typing into one entry, and tells which version of the document is showing, so "unsaved
//! changes" can follow undo back to the saved state.

/// A step that can join the step before it (typing a character after a character).
pub trait Step: Clone {
    fn absorb(&mut self, _next: &Self) -> bool {
        false
    }
}

impl Step for crate::edit::Splice {
    fn absorb(&mut self, next: &Self) -> bool {
        crate::edit::Splice::absorb(self, next)
    }
}

#[derive(Clone, Debug)]
pub struct Entry<S, Sel> {
    pub steps: Vec<S>,
    /// The selection before the change, restored by undo.
    pub before: Sel,
    /// The selection after it, restored by redo.
    pub after: Sel,
    kind: Option<&'static str>,
    version: u64,
}

pub struct History<S, Sel> {
    undo: Vec<Entry<S, Sel>>,
    redo: Vec<Entry<S, Sel>>,
    /// The last entry takes no more steps of its kind (the caret moved, or time passed).
    sealed: bool,
    group: Option<Entry<S, Sel>>,
    next_version: u64,
    limit: usize,
}

impl<S: Step, Sel: Clone> Default for History<S, Sel> {
    fn default() -> Self {
        History { undo: Vec::new(), redo: Vec::new(), sealed: true, group: None, next_version: 1, limit: 500 }
    }
}

impl<S: Step, Sel: Clone> History<S, Sel> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a change. A change of the same `kind` as the last (`"typing"`) joins it until
    /// [`History::seal`] is called.
    pub fn record(&mut self, steps: Vec<S>, before: Sel, after: Sel, kind: Option<&'static str>) {
        if steps.is_empty() {
            return;
        }
        if let Some(group) = &mut self.group {
            push_steps(&mut group.steps, steps);
            group.after = after;
            return;
        }
        self.redo.clear();
        if !self.sealed && kind.is_some() {
            if let Some(last) = self.undo.last_mut() {
                if last.kind == kind {
                    push_steps(&mut last.steps, steps);
                    last.after = after;
                    last.version = self.next_version;
                    self.next_version += 1;
                    return;
                }
            }
        }
        let version = self.next_version;
        self.next_version += 1;
        self.undo.push(Entry { steps, before, after, kind, version });
        if self.undo.len() > self.limit {
            self.undo.remove(0);
        }
        self.sealed = kind.is_none();
    }

    /// Ends the current run of typing, so the next change is undone on its own.
    pub fn seal(&mut self) {
        self.sealed = true;
    }

    /// Starts collecting changes into one entry, until [`History::end_group`].
    pub fn begin_group(&mut self, before: Sel) {
        if self.group.is_none() {
            self.group = Some(Entry { steps: Vec::new(), before: before.clone(), after: before, kind: None, version: 0 });
        }
    }

    pub fn end_group(&mut self) {
        if let Some(g) = self.group.take() {
            self.record(g.steps, g.before, g.after, None);
            self.sealed = true;
        }
    }

    /// Takes the last change off the undo stack for the layer to reverse (its steps in reverse
    /// order), and keeps it for redo.
    pub fn undo(&mut self) -> Option<Entry<S, Sel>> {
        self.end_group();
        let e = self.undo.pop()?;
        self.redo.push(e.clone());
        self.sealed = true;
        Some(e)
    }

    pub fn redo(&mut self) -> Option<Entry<S, Sel>> {
        let e = self.redo.pop()?;
        self.undo.push(e.clone());
        self.sealed = true;
        Some(e)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty() || self.group.as_ref().is_some_and(|g| !g.steps.is_empty())
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Which version of the document is showing: compare with the version when it was saved.
    pub fn version(&self) -> u64 {
        self.undo.last().map(|e| e.version).unwrap_or(0)
    }
}

fn push_steps<S: Step>(into: &mut Vec<S>, steps: Vec<S>) {
    for s in steps {
        if let Some(last) = into.last_mut() {
            if last.absorb(&s) {
                continue;
            }
        }
        into.push(s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Debug, PartialEq)]
    struct Add(i32);
    impl Step for Add {}

    #[test]
    fn typing_joins_until_sealed() {
        let mut h: History<Add, u32> = History::new();
        h.record(vec![Add(1)], 0, 1, Some("typing"));
        h.record(vec![Add(2)], 1, 2, Some("typing"));
        h.seal();
        h.record(vec![Add(3)], 2, 3, Some("typing"));
        let e = h.undo().unwrap();
        assert_eq!(e.steps, vec![Add(3)]);
        let e = h.undo().unwrap();
        assert_eq!((e.steps.len(), e.before, e.after), (2, 0, 2));
        assert!(!h.can_undo());
        assert_eq!(h.redo().unwrap().after, 2);
    }

    #[test]
    fn versions_follow_undo() {
        let mut h: History<Add, ()> = History::new();
        assert_eq!(h.version(), 0);
        h.record(vec![Add(1)], (), (), None);
        let saved = h.version();
        h.record(vec![Add(2)], (), (), None);
        assert_ne!(h.version(), saved);
        h.undo();
        assert_eq!(h.version(), saved);
        h.undo();
        assert_eq!(h.version(), 0);
    }

    #[test]
    fn groups_are_one_entry() {
        let mut h: History<Add, u8> = History::new();
        h.begin_group(0);
        h.record(vec![Add(1)], 0, 1, None);
        h.record(vec![Add(2)], 1, 2, None);
        h.end_group();
        let e = h.undo().unwrap();
        assert_eq!((e.steps.len(), e.before, e.after), (2, 0, 2));
    }
}
