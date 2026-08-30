export interface QCInspection {

    id: string;

    billetId: string;

    rebarSize: string;

    measuredDiameter: number;

    crossSectionArea: number;

    yieldStrength: number;

    tensileStrength: number;

    yieldRatio: number;

    maxLoad: number;

    elongation: number;

    bendTestPassed: boolean;

    visualInspectionPassed: boolean;

    inspectorId: string;

    inspectorName?: string;

    machineId?: string;

    machineName?: string;

    shiftId?: string;

    workshopId?: string;

    remarks?: string;

    createdAt: string;

    updatedAt: string;

    syncStatus: number;

    remoteId?: string;

}