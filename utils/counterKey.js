const getCounterKey = (name) => {
  const namespace = String(process.env.COUNTER_NAMESPACE || '').trim();
  return namespace ? `${namespace}:${name}` : name;
};

module.exports = { getCounterKey };
