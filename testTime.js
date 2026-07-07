function getLocalTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { 
        timeZone: 'Europe/Berlin',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(now);
    const val = (type) => parts.find(p => p.type === type)?.value || "";
    
    const isoStr = `${val('year')}-${val('month')}-${val('day')}T${val('hour')}:${val('minute')}:${val('second')}`;
    const berlinDate = new Date(isoStr);

    return {
        h: parseInt(val('hour')),
        m: parseInt(val('minute')),
        day: berlinDate.getDay(),
        iso: `${val('year')}-${val('month')}-${val('day')}`,
        dateStr: berlinDate.toDateString(),
        full: berlinDate,
        nowTs: now.getTime()
    };
}
console.log(getLocalTime());
