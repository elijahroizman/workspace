/** Undo/redo for page edits and annotations. Each step knows how to do and undo itself. */
export interface Step {
  undo(): Promise<void>
  redo(): Promise<void>
}

export class History {
  private done: (Step & { id: number })[] = []
  private undone: (Step & { id: number })[] = []
  private nextId = 1
  private savedId = 0

  get canUndo() {
    return this.done.length > 0
  }
  get canRedo() {
    return this.undone.length > 0
  }
  /** Identifies the document's current state, so undoing back to the saved one counts as clean. */
  private get stateId() {
    return this.done.at(-1)?.id ?? 0
  }
  get dirty() {
    return this.stateId !== this.savedId
  }

  push(step: Step) {
    this.done.push({ ...step, id: this.nextId++ })
    this.undone = []
  }

  async undo() {
    const step = this.done.pop()
    if (!step) return false
    try {
      await step.undo()
    } catch (err) {
      // Can't be undone any more (say, its page was deleted); drop it.
      console.warn(err)
      return false
    }
    this.undone.push(step)
    return true
  }

  async redo() {
    const step = this.undone.pop()
    if (!step) return false
    try {
      await step.redo()
    } catch (err) {
      console.warn(err)
      return false
    }
    this.done.push(step)
    return true
  }

  markSaved() {
    this.savedId = this.stateId
  }
}
