import { evaluateMealSafety, normalizeMedicationInput } from '../examples/core-feature-snippet';

describe('Institutional Clinical Safety & DDI Engine Test Suite', () => {

  describe('1. Fixed-Dose Combination (FDC) Decomposer', () => {
    it('should decompose Combiflam into Ibuprofen and Paracetamol molecules', () => {
      const drug = normalizeMedicationInput('Combiflam');
      expect(drug.isCombination).toBe(true);
      expect(drug.activeMolecules).toContain('Ibuprofen');
      expect(drug.activeMolecules).toContain('Paracetamol');
      expect(drug.resolutionSource).toBe('COMBO_SPLITTER');
    });

    it('should normalize local brand Dolo 650 to generic Paracetamol', () => {
      const drug = normalizeMedicationInput('Dolo 650');
      expect(drug.genericName).toBe('Paracetamol');
      expect(drug.resolutionSource).toBe('LOCAL_DICTIONARY');
    });
  });

  describe('2. Deterministic Pharmacological Contraindication Detection', () => {
    it('should detect a CRITICAL hazard when patient on Lipitor (Statin) eats Grapefruit', () => {
      const report = evaluateMealSafety(
        ['Fresh Pink Grapefruit Wedges', 'Grilled Chicken', 'Steamed Quinoa'],
        ['Lipitor 20mg']
      );

      expect(report.hasCriticalHazard).toBe(true);
      expect(report.totalInteractions).toBeGreaterThanOrEqual(1);
      expect(report.flaggedMedications).toContain('Atorvastatin');
      expect(report.interactions[0].severity).toBe('CRITICAL');
      expect(report.interactions[0].headline).toContain('Atorvastatin + grapefruit');
    });

    it('should detect a CRITICAL hazard when patient on Warfarin consumes concentrated raw kale', () => {
      const report = evaluateMealSafety(
        ['Raw Kale Caesar Salad', 'Croutons', 'Parmesan'],
        ['Warfarin 5mg']
      );

      expect(report.hasCriticalHazard).toBe(true);
      const warfarinHazard = report.interactions.find(i => i.drugA === 'Warfarin');
      expect(warfarinHazard).toBeDefined();
      expect(warfarinHazard?.severity).toBe('CRITICAL');
    });

    it('should clear meals with no pharmacological conflicts', () => {
      const report = evaluateMealSafety(
        ['Grilled Salmon', 'Steamed Asparagus', 'Brown Rice'],
        ['Metformin 500mg']
      );

      expect(report.hasCriticalHazard).toBe(false);
      expect(report.totalInteractions).toBe(0);
      expect(report.summaryMessage).toContain('Meal Cleared');
    });
  });
});
