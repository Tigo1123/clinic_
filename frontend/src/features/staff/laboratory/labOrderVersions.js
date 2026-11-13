function versionOf(item) {
  return Number.isSafeInteger(item?.resultVersion) && item.resultVersion >= 0
    ? item.resultVersion
    : -1;
}

export function mergeLabOrdersMonotonically(currentOrders, incomingOrders) {
  const currentById = new Map((currentOrders || []).map((order) => [order.id, order]));

  return (incomingOrders || []).map((incomingOrder) => {
    const currentOrder = currentById.get(incomingOrder.id);
    if (!currentOrder) return incomingOrder;

    const currentItemsById = new Map((currentOrder.items || []).map((item) => [item.id, item]));
    return {
      ...incomingOrder,
      items: (incomingOrder.items || []).map((incomingItem) => {
        const currentItem = currentItemsById.get(incomingItem.id);
        return currentItem && versionOf(incomingItem) < versionOf(currentItem)
          ? currentItem
          : incomingItem;
      })
    };
  });
}

export function createLatestRequestGate() {
  let generation = 0;
  let active = true;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(candidate) {
      return active && candidate === generation;
    },
    invalidate() {
      active = false;
      generation += 1;
    }
  };
}
