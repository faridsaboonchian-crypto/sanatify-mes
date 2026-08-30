import React from 'react';
import ManagerScreen from './ManagerScreen'; // بازخوانی اسکلت میز کار مدیر

export default function ManagerDashboard({ navigation }: { navigation: any }) {
    return <ManagerScreen navigation={navigation} />;
}