/**
 * The persisted setting is a legacy negative switch. Undefined therefore
 * means no consent; only an explicit `false` opts the user in.
 */
export function isTelemetryOptedIn(disableTelemetry?: boolean) {
    return disableTelemetry === false;
}
