/**
 * Constant for the "User specified" menu option.
 * Import this in MenuBoxes to check if this option was selected.
 */
export const OPTION_USER_SPECIFIED = "User specified path";

/**
 * Generates a list of menu options for compartments based on available simulation paths.
 *
 * Ordering:
 *   1. soma (if present) — always first
 *   2. base# wildcards — for any base name with multiple numeric-suffix entries
 *      (e.g. head0, head1, head2 → head#), sorted alphabetically
 *   3. Individual paths — up to 10, sorted, excluding shaft compartments
 *   4. "User specified path" — always last
 *
 * @param {string[]} simPaths - List of simulation paths (e.g. ["soma", "dend0", "head0"])
 * @returns {string[]} - Array of strings for use in a Dropdown/Select menu.
 */
export const getCompartmentOptions = (simPaths = []) => {
    if (!simPaths || !Array.isArray(simPaths)) {
        return [OPTION_USER_SPECIFIED];
    }

    // Filter shafts — internal spine connectors, not useful as stim/plot targets
    const filtered = simPaths.filter(p => !p.includes('shaft'));
    // Natural sort so head2 comes before head10
    const sortedPaths = [...filtered].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const result = [];
    const seen = new Set();

    // 1. soma first
    const soma = sortedPaths.find(p => p === 'soma' || p.endsWith('/soma'));
    if (soma) { result.push(soma); seen.add(soma); }

    // 2. Wildcards — sorted so the order is deterministic
    const baseCounts = {};
    sortedPaths.forEach(p => {
        const m = p.match(/^([a-zA-Z_]+)\d+$/);
        if (m) baseCounts[m[1]] = (baseCounts[m[1]] || 0) + 1;
    });
    Object.keys(baseCounts).sort().forEach(base => {
        if (baseCounts[base] > 1) result.push(base + '#');
    });

    // 3. Individual paths up to a cap of 10
    let added = 0;
    for (const p of sortedPaths) {
        if (added >= 10) break;
        if (!seen.has(p)) { result.push(p); seen.add(p); added++; }
    }

    // 4. User specified last
    result.push(OPTION_USER_SPECIFIED);
    return result;
};
