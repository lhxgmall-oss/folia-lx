// dev/folium/sample-remote-ui/main.cjs
// Offline RPC shared by the main and companion windows. No accounts or network.
module.exports = (api) => {
    let count = 0;
    api.rpc.handle('increment', () => {
        count += 1;
        api.log.info(`remote.ui example count: ${count}`);
        return count;
    });
};
