export interface Milestone {
  progress: number;
  label: string;
}

/** Opening values for the phase structure; thresholds are meant to move. */
export const MILESTONES: Milestone[] = [
  { progress: 0.1, label: "Premier choix majeur" },
  { progress: 0.25, label: "Mutation de deck" },
  { progress: 0.5, label: "Événement élite" },
  { progress: 0.75, label: "Overdrive" },
  { progress: 0.9, label: "Accélération du nettoyage" },
  { progress: 0.99, label: "Phase « derniers pixels »" },
  { progress: 1, label: "Image détruite" },
];

export class MilestoneTracker {
  private reached = new Set<number>();

  constructor(alreadyReachedProgress = 0) {
    for (const milestone of MILESTONES) {
      if (alreadyReachedProgress >= milestone.progress) this.reached.add(milestone.progress);
    }
  }

  /** Returns the milestones crossed since the last call. */
  update(progress: number): Milestone[] {
    const crossed: Milestone[] = [];
    for (const milestone of MILESTONES) {
      if (progress >= milestone.progress && !this.reached.has(milestone.progress)) {
        this.reached.add(milestone.progress);
        crossed.push(milestone);
      }
    }
    return crossed;
  }
}
