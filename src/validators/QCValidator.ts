import { QCInspection } from "../types/QCInspection";

export interface ValidationResult {

    valid: boolean;

    errors: string[];

}

export class QCValidator {

    static validate(data: Partial<QCInspection>): ValidationResult {

        const errors: string[] = [];

        if (!data.billetId?.trim()) {
            errors.push("Billet ID is required.");
        }

        if (!data.rebarSize?.trim()) {
            errors.push("Nominal rebar size is required.");
        }

        if (
            data.measuredDiameter === undefined ||
            data.measuredDiameter <= 0
        ) {
            errors.push("Measured diameter must be greater than zero.");
        }

        if (
            data.crossSectionArea === undefined ||
            data.crossSectionArea <= 0
        ) {
            errors.push("Cross section area is invalid.");
        }

        if (
            data.yieldStrength === undefined ||
            data.yieldStrength <= 0
        ) {
            errors.push("Yield strength is invalid.");
        }

        if (
            data.tensileStrength === undefined ||
            data.tensileStrength <= 0
        ) {
            errors.push("Tensile strength is invalid.");
        }

        if (
            data.yieldStrength &&
            data.tensileStrength &&
            data.tensileStrength < data.yieldStrength
        ) {
            errors.push(
                "Tensile strength cannot be lower than Yield strength."
            );
        }

        if (
            data.maxLoad !== undefined &&
            data.maxLoad < 0
        ) {
            errors.push(
                "Maximum load cannot be negative."
            );
        }

        if (
            data.elongation !== undefined &&
            (
                data.elongation < 0 ||
                data.elongation > 100
            )
        ) {
            errors.push(
                "Elongation must be between 0 and 100."
            );
        }

        return {

            valid: errors.length === 0,

            errors

        };

    }

}