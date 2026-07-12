const nextState = {
    jobs: [
        { status: 'resolved', created: '2026-06-01T10:00:00.000Z' },
        { status: 'open', created: '2026-06-01T10:00:00.000Z' },
        { status: 'resolved', created: '2026-07-06T10:00:00.000Z' }
    ]
};
const now = new Date('2026-07-07T12:00:00.000Z').getTime();
const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

if (nextState.jobs) {
    nextState.jobs = nextState.jobs.filter((j) => {
        if (j.status === 'open' || j.status === 'in_progress') return true;
        if (j.created) {
            return new Date(j.created).getTime() > twoWeeksAgo.getTime();
        }
        return true;
    });
}
console.log(nextState.jobs);
