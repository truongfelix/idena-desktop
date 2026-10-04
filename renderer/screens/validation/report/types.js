export const ValidationResult = {
  Success: 'success',
  Penalty: 'penalty',
  LateSubmission: 'late',
  MissedValidation: 'missed',
  WrongAnswers: 'wrong',
  Fail: 'fail',
}

// What the node's validation summary (dna_validationSummary) says about the identity in the last ceremony.
export const ValidationSummaryStatus = {
  Recorded: 'recorded',
  // The node did not apply that ceremony's block (not running, not synchronized, or an older node).
  NotRecorded: 'notRecorded',
  // No identity that could take part in the ceremony.
  NotParticipated: 'notParticipated',
  // Nobody was validated: identities stayed as they were.
  ValidationFailed: 'validationFailed',
  // The node cannot answer (no dna_validationSummary, or not reachable).
  Unavailable: 'unavailable',
}
